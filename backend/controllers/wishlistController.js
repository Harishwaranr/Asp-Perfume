const Wishlist = require('../models/Wishlist');
const Product = require('../models/Product');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { toCardShape } = require('./productController');

async function loadWishlist(userId) {
  let wl = await Wishlist.findOne({ user: userId }).populate('products');
  if (!wl) wl = await Wishlist.create({ user: userId, products: [] });
  return wl;
}

/** Filters out products an admin has since deleted or deactivated. */
function serialise(wl) {
  const products = (wl.products || []).filter((p) => p && p.isActive);
  return { products: products.map(toCardShape), count: products.length };
}

/** GET /api/wishlist — Private */
const getWishlist = asyncHandler(async (req, res) => {
  const wl = await loadWishlist(req.user._id);
  res.json({ success: true, wishlist: serialise(wl) });
});

/**
 * POST /api/wishlist — Private
 * Body: { productId }
 * Idempotent: adding an item already present is a no-op, not an error.
 * The frontend heart toggles quickly, so a duplicate click must be harmless.
 */
const addToWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.body;
  if (!productId) throw new ApiError(400, 'productId is required.');

  const product = await Product.findById(productId);
  if (!product || !product.isActive) throw new ApiError(404, 'That fragrance is not available.');

  const wl = await loadWishlist(req.user._id);
  const already = wl.products.some((p) => (p._id || p).toString() === productId.toString());

  if (!already) {
    wl.products.push(product._id);
    await wl.save();
  }

  const fresh = await loadWishlist(req.user._id);
  res.status(already ? 200 : 201).json({
    success: true,
    message: already ? `${product.name} is already saved.` : `${product.name} saved to your wishlist.`,
    wishlist: serialise(fresh),
  });
});

/** DELETE /api/wishlist/:productId — Private */
const removeFromWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const wl = await loadWishlist(req.user._id);

  const before = wl.products.length;
  wl.products = wl.products.filter((p) => (p._id || p).toString() !== productId.toString());

  if (wl.products.length === before) throw new ApiError(404, 'That item is not in your wishlist.');

  await wl.save();
  const fresh = await loadWishlist(req.user._id);
  res.json({ success: true, message: 'Removed from wishlist.', wishlist: serialise(fresh) });
});

/** POST /api/wishlist/merge — Private. Body: { productIds: [] } */
const mergeWishlist = asyncHandler(async (req, res) => {
  const { productIds } = req.body;
  if (!Array.isArray(productIds)) throw new ApiError(400, 'productIds must be an array.');

  const wl = await loadWishlist(req.user._id);
  const existing = new Set(wl.products.map((p) => (p._id || p).toString()));

  for (const pid of productIds) {
    if (!pid || existing.has(pid.toString())) continue;
    const product = await Product.findById(pid).catch(() => null);
    if (product && product.isActive) {
      wl.products.push(product._id);
      existing.add(pid.toString());
    }
  }

  await wl.save();
  const fresh = await loadWishlist(req.user._id);
  res.json({ success: true, message: 'Wishlist merged.', wishlist: serialise(fresh) });
});

module.exports = { getWishlist, addToWishlist, removeFromWishlist, mergeWishlist };
