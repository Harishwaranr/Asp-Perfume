const Product = require('../models/Product');
const { CATEGORIES } = require('../models/Product');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

/**
 * Shapes a product into exactly the flat structure the frontend's
 * data-* attributes expect. Keeping this in one function means the
 * card renderer, quick view and search all receive identical objects.
 */
function toCardShape(p) {
  return {
    _id: p._id,
    slug: p.slug,
    name: p.name,
    size: p.size,
    price: p.price,
    compareAtPrice: p.compareAtPrice || null,
    img: p.image,
    gallery: p.gallery || [],
    tag: p.tag || '',
    desc: p.description,
    category: p.category,
    top: p.notes?.top || '',
    heart: p.notes?.heart || '',
    base: p.notes?.base || '',
    longevity: p.longevity || '',
    sillage: p.sillage || '',
    occasion: p.occasion || '',
    season: p.season || '',
    stock: p.stock,
    inStock: p.stock > 0,
    rating: p.rating,
    numReviews: p.numReviews,
  };
}

/**
 * GET /api/products
 * Public
 *
 * Query params:
 *   search    free-text across name, description and notes
 *   category  one of the CATEGORIES values
 *   minPrice / maxPrice
 *   sort      newest | price_asc | price_desc | name | featured (default)
 *   page, limit
 */
const getProducts = asyncHandler(async (req, res) => {
  const {
    search = '',
    category = '',
    minPrice,
    maxPrice,
    sort = 'featured',
    page = 1,
    limit = 24,
  } = req.query;

  const filter = { isActive: true };

  if (category && category !== 'All') {
    if (!CATEGORIES.includes(category)) {
      throw new ApiError(400, `Unknown category "${category}". Valid: ${CATEGORIES.join(', ')}`);
    }
    filter.category = category;
  }

  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);
  }

  // Regex rather than $text here: your search box does live
  // as-you-type filtering, and $text won't match partial words
  // like "mid" -> "Midnight". Regex does. It is a slower query,
  // but at this catalogue size that is irrelevant.
  if (search.trim()) {
    const safe = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(safe, 'i');
    filter.$or = [
      { name: rx },
      { description: rx },
      { category: rx },
      { 'notes.top': rx },
      { 'notes.heart': rx },
      { 'notes.base': rx },
      { occasion: rx },
      { season: rx },
    ];
  }

  const sortMap = {
    newest: { createdAt: -1 },
    price_asc: { price: 1 },
    price_desc: { price: -1 },
    name: { name: 1 },
    featured: { sortOrder: 1, createdAt: -1 },
  };

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(limit, 10) || 24));

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort(sortMap[sort] || sortMap.featured)
      .skip((pageNum - 1) * perPage)
      .limit(perPage)
      .lean(),
    Product.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: products.length,
    total,
    page: pageNum,
    pages: Math.ceil(total / perPage) || 1,
    products: products.map(toCardShape),
  });
});

/**
 * GET /api/products/categories
 * Public — returns each category with a live product count,
 * so the frontend can build filter chips without hardcoding.
 */
const getCategories = asyncHandler(async (req, res) => {
  const counts = await Product.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const total = counts.reduce((s, c) => s + c.count, 0);

  res.json({
    success: true,
    categories: [
      { name: 'All', count: total },
      ...counts.map((c) => ({ name: c._id, count: c.count })),
    ],
  });
});

/**
 * GET /api/products/:id
 * Public — accepts either a Mongo ObjectId or a slug.
 */
const getProductById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);

  const product = await Product.findOne(
    isObjectId ? { _id: id } : { slug: id.toLowerCase() }
  ).lean();

  if (!product || !product.isActive) {
    throw new ApiError(404, 'That fragrance could not be found.');
  }

  // A few related items from the same family, for the quick-view footer.
  const related = await Product.find({
    category: product.category,
    _id: { $ne: product._id },
    isActive: true,
  })
    .limit(3)
    .lean();

  res.json({
    success: true,
    product: toCardShape(product),
    related: related.map(toCardShape),
  });
});

module.exports = { getProducts, getCategories, getProductById, toCardShape };
