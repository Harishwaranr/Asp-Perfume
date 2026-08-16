const Product = require('../models/Product');
const Order = require('../models/Order');
const { ORDER_STATUSES } = require('../models/Order');
const User = require('../models/User');
const Contact = require('../models/Contact');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

/* ─────────────── PRODUCTS ─────────────── */

/**
 * GET /api/admin/products
 * Admin — unlike the public route, this returns inactive products too,
 * because an admin needs to see and restore what they've hidden.
 */
const listProducts = asyncHandler(async (req, res) => {
  const { search = '', includeInactive = 'true' } = req.query;
  const filter = {};

  if (includeInactive !== 'true') filter.isActive = true;
  if (search.trim()) {
    const safe = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.name = new RegExp(safe, 'i');
  }

  const products = await Product.find(filter).sort({ sortOrder: 1, createdAt: -1 }).lean();
  res.json({ success: true, count: products.length, products });
});

/** POST /api/admin/products — Admin */
const createProduct = asyncHandler(async (req, res) => {
  const {
    name, description, price, size, image, category,
    tag, notes, longevity, sillage, occasion, season,
    stock, isActive, sortOrder, compareAtPrice, gallery,
  } = req.body;

  if (!name || !description || price === undefined || !image || !category) {
    throw new ApiError(400, 'name, description, price, image and category are all required.');
  }
  if (Number(price) < 0) throw new ApiError(400, 'Price cannot be negative.');

  const product = await Product.create({
    name: name.trim(),
    description: description.trim(),
    price: Number(price),
    compareAtPrice: compareAtPrice ? Number(compareAtPrice) : undefined,
    size: size || '50ml',
    image: image.trim(),
    gallery: Array.isArray(gallery) ? gallery : [],
    category,
    tag: tag || '',
    notes: {
      top: notes?.top || '',
      heart: notes?.heart || '',
      base: notes?.base || '',
    },
    longevity: longevity || '',
    sillage: sillage || '',
    occasion: occasion || '',
    season: season || '',
    stock: stock !== undefined ? Number(stock) : 0,
    isActive: isActive !== undefined ? Boolean(isActive) : true,
    sortOrder: sortOrder !== undefined ? Number(sortOrder) : 100,
  });

  res.status(201).json({ success: true, message: `${product.name} created.`, product });
});

/**
 * PUT /api/admin/products/:id — Admin
 * Only whitelisted fields are copied across. A blanket Object.assign(product,
 * req.body) would let a malformed request overwrite _id, createdAt or rating.
 */
const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new ApiError(404, 'Product not found.');

  const allowed = [
    'name', 'description', 'price', 'compareAtPrice', 'size', 'image', 'gallery',
    'category', 'tag', 'longevity', 'sillage', 'occasion', 'season',
    'stock', 'isActive', 'sortOrder',
  ];

  for (const field of allowed) {
    if (req.body[field] !== undefined) product[field] = req.body[field];
  }

  if (req.body.notes) {
    product.notes = {
      top: req.body.notes.top ?? product.notes.top,
      heart: req.body.notes.heart ?? product.notes.heart,
      base: req.body.notes.base ?? product.notes.base,
    };
  }

  await product.save();
  res.json({ success: true, message: `${product.name} updated.`, product });
});

/**
 * DELETE /api/admin/products/:id — Admin
 *
 * SOFT delete by default (isActive:false). Hard-deleting a product breaks
 * every historical order that references it. Pass ?hard=true only if you
 * really mean it — and only for products that were never ordered.
 */
const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new ApiError(404, 'Product not found.');

  if (req.query.hard === 'true') {
    const orderCount = await Order.countDocuments({ 'items.product': product._id });
    if (orderCount > 0) {
      throw new ApiError(
        409,
        `${product.name} appears in ${orderCount} order(s) and cannot be hard-deleted. Archive it instead.`
      );
    }
    await product.deleteOne();
    return res.json({ success: true, message: `${product.name} permanently deleted.` });
  }

  product.isActive = false;
  await product.save();
  res.json({ success: true, message: `${product.name} archived and hidden from the storefront.`, product });
});

/* ─────────────── ORDERS ─────────────── */

/** GET /api/admin/orders — Admin. Filters: status, search, page, limit */
const listOrders = asyncHandler(async (req, res) => {
  const { status = '', search = '', page = 1, limit = 25 } = req.query;
  const filter = {};

  if (status && status !== 'All') {
    if (!ORDER_STATUSES.includes(status)) {
      throw new ApiError(400, `Unknown status "${status}".`);
    }
    filter.status = status;
  }

  if (search.trim()) {
    const safe = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(safe, 'i');
    filter.$or = [{ orderId: rx }, { 'shipping.name': rx }, { 'shipping.email': rx }, { 'shipping.phone': rx }];
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const perPage = Math.min(100, parseInt(limit, 10) || 25);

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * perPage)
      .limit(perPage)
      .lean(),
    Order.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: orders.length,
    total,
    page: pageNum,
    pages: Math.ceil(total / perPage) || 1,
    statuses: ORDER_STATUSES,
    orders,
  });
});

/**
 * PUT /api/admin/orders/:id/status — Admin
 * Body: { status, note? }
 */
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status, note = '' } = req.body;

  if (!ORDER_STATUSES.includes(status)) {
    throw new ApiError(400, `status must be one of: ${ORDER_STATUSES.join(', ')}`);
  }

  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found.');

  if (order.status === 'Delivered' && status !== 'Delivered') {
    throw new ApiError(400, 'A delivered order cannot be moved back to an earlier status.');
  }

  // Cancelling from the admin side must also restore stock, exactly as the
  // customer-side cancel does — otherwise inventory drifts out of sync.
  if (status === 'Cancelled' && order.status !== 'Cancelled') {
    for (const item of order.items) {
      if (item.product) {
        await Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } });
      }
    }
    const buyer = await User.findById(order.user);
    if (buyer) {
      buyer.points = Math.max(0, buyer.points + order.pointsUsed - order.pointsEarned);
      await buyer.save();
    }
    order.cancelledAt = new Date();
    order.payment.status = order.payment.status === 'paid' ? 'refunded' : 'failed';
  }

  if (status === 'Delivered') {
    order.deliveredAt = new Date();
    if (order.payment.method === 'cod') order.payment.status = 'paid';
  }

  order.status = status;
  order.statusHistory.push({ status, note, at: new Date() });
  await order.save();

  res.json({ success: true, message: `Order ${order.orderId} is now "${status}".`, order });
});

/* ─────────────── CONTACTS & USERS ─────────────── */

/** GET /api/admin/contacts — Admin */
const listContacts = asyncHandler(async (req, res) => {
  const { type = '', status = '' } = req.query;
  const filter = {};
  if (type) filter.type = type;
  if (status) filter.status = status;

  const contacts = await Contact.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ success: true, count: contacts.length, contacts });
});

/** PUT /api/admin/contacts/:id — Admin. Body: { status?, adminNote? } */
const updateContact = asyncHandler(async (req, res) => {
  const contact = await Contact.findById(req.params.id);
  if (!contact) throw new ApiError(404, 'Submission not found.');

  if (req.body.status) {
    if (!['new', 'read', 'resolved'].includes(req.body.status)) {
      throw new ApiError(400, 'status must be new, read or resolved.');
    }
    contact.status = req.body.status;
  }
  if (req.body.adminNote !== undefined) contact.adminNote = req.body.adminNote;

  await contact.save();
  res.json({ success: true, message: 'Submission updated.', contact });
});

/** GET /api/admin/users — Admin */
const listUsers = asyncHandler(async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 }).limit(200).lean();
  res.json({
    success: true,
    count: users.length,
    users: users.map((u) => ({
      _id: u._id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      points: u.points,
      createdAt: u.createdAt,
    })),
  });
});

/** GET /api/admin/stats — Admin dashboard tiles */
const getStats = asyncHandler(async (req, res) => {
  const [
    totalProducts,
    activeProducts,
    lowStock,
    totalOrders,
    pendingOrders,
    totalUsers,
    newContacts,
    revenueAgg,
  ] = await Promise.all([
    Product.countDocuments(),
    Product.countDocuments({ isActive: true }),
    Product.countDocuments({ isActive: true, stock: { $lte: 5 } }),
    Order.countDocuments(),
    Order.countDocuments({ status: { $nin: ['Delivered', 'Cancelled'] } }),
    User.countDocuments({ role: 'user' }),
    Contact.countDocuments({ status: 'new' }),
    // Cancelled orders are excluded — counting them would inflate revenue.
    Order.aggregate([
      { $match: { status: { $ne: 'Cancelled' } } },
      { $group: { _id: null, total: { $sum: '$grandTotal' }, count: { $sum: 1 } } },
    ]),
  ]);

  const revenue = revenueAgg[0]?.total || 0;
  const paidCount = revenueAgg[0]?.count || 0;

  res.json({
    success: true,
    stats: {
      totalProducts,
      activeProducts,
      lowStock,
      totalOrders,
      pendingOrders,
      totalUsers,
      newContacts,
      revenue,
      averageOrderValue: paidCount ? Math.round(revenue / paidCount) : 0,
    },
  });
});

module.exports = {
  listProducts, createProduct, updateProduct, deleteProduct,
  listOrders, updateOrderStatus,
  listContacts, updateContact,
  listUsers, getStats,
};
