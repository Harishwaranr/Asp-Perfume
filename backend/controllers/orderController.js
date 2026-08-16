const Order = require('../models/Order');
const Product = require('../models/Product');
const Cart = require('../models/Cart');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { loadCart } = require('./cartController');
const { calculateRedemption, pointsEarnedFor, pointsToRupees } = require('../utils/points');

const FREE_SHIPPING_THRESHOLD = 1500;
const SHIPPING_FEE = 99;

/**
 * Validates payment details WITHOUT persisting anything sensitive.
 *
 * Important: this is a simulated gateway, exactly as your README describes.
 * The card branch below accepts a `last4` only. It will reject a full card
 * number outright. Storing PANs or CVVs would put you inside PCI-DSS scope
 * and is not something a project like this should ever do — when you go live,
 * Razorpay/Stripe should tokenise the card in the browser and your server
 * should only ever see their token.
 */
function validatePayment(payment = {}) {
  const { method, upiId, last4, bank } = payment;

  if (!['upi', 'card', 'netbank', 'cod'].includes(method)) {
    throw new ApiError(400, 'Payment method must be one of: upi, card, netbank, cod.');
  }

  if (method === 'upi') {
    if (!upiId || !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upiId.trim())) {
      throw new ApiError(400, 'Please provide a valid UPI ID, e.g. name@upi.');
    }
    return { method, status: 'paid', reference: upiId.trim(), paidAt: new Date() };
  }

  if (method === 'card') {
    if (!last4 || !/^\d{4}$/.test(String(last4))) {
      throw new ApiError(
        400,
        'Send only the last 4 digits of the card as `last4`. This API will not accept full card numbers.'
      );
    }
    return { method, status: 'paid', reference: `card-****${last4}`, paidAt: new Date() };
  }

  if (method === 'netbank') {
    if (!bank || !bank.trim()) throw new ApiError(400, 'Please select a bank.');
    return { method, status: 'paid', reference: bank.trim(), paidAt: new Date() };
  }

  return { method: 'cod', status: 'pending', reference: 'Cash on delivery' };
}

/**
 * POST /api/orders
 * Private
 * Body: { shipping:{...}, payment:{ method, upiId|last4|bank }, pointsToRedeem? }
 *
 * The cart is read from the DATABASE, not from the request body. The client
 * never gets to say what it is buying or what it costs — it only says where
 * to ship it and how it is paying. That closes the price-tampering hole.
 */
const createOrder = asyncHandler(async (req, res) => {
  const { shipping, payment, pointsToRedeem = 0 } = req.body;

  if (!shipping) throw new ApiError(400, 'Shipping details are required.');

  const required = ['name', 'phone', 'email', 'address', 'city', 'state', 'pincode'];
  const missing = required.filter((f) => !shipping[f] || !String(shipping[f]).trim());
  if (missing.length) {
    throw new ApiError(400, `Missing shipping fields: ${missing.join(', ')}`);
  }

  const cart = await loadCart(req.user._id);
  if (!cart.items.length) {
    throw new ApiError(400, 'Your cart is empty.');
  }

  // ---- Build line items from live product data ----
  const items = [];
  let itemsTotal = 0;

  for (const line of cart.items) {
    const product = line.product;
    if (!product || !product.isActive) {
      throw new ApiError(409, `"${product?.name || 'An item'}" is no longer available. Please remove it and try again.`);
    }
    if (product.stock < line.quantity) {
      throw new ApiError(
        409,
        `Only ${product.stock} units of ${product.name} remain — please reduce the quantity.`
      );
    }

    const subtotal = product.price * line.quantity;
    itemsTotal += subtotal;

    items.push({
      product: product._id,
      name: product.name,
      size: product.size,
      image: product.image,
      price: product.price,
      quantity: line.quantity,
      subtotal,
    });
  }

  // ---- Points, shipping, totals ----
  const redemption = calculateRedemption(pointsToRedeem, req.user.points, itemsTotal);
  if (redemption.reason && Number(pointsToRedeem) > 0) {
    throw new ApiError(400, redemption.reason);
  }

  const shippingFee = itemsTotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
  const grandTotal = Math.max(0, itemsTotal - redemption.discount + shippingFee);

  const paymentRecord = validatePayment(payment);

  // ---- Decrement stock atomically ----
  // Each update only succeeds if stock is STILL >= quantity at write time.
  // This is what prevents two shoppers checking out the last bottle at once.
  // If any one fails we roll the earlier ones back by hand, because a
  // standalone mongod has no multi-document transactions.
  const decremented = [];
  for (const item of items) {
    const ok = await Product.findOneAndUpdate(
      { _id: item.product, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity } },
      { new: true }
    );
    if (!ok) {
      for (const done of decremented) {
        await Product.updateOne({ _id: done.product }, { $inc: { stock: done.quantity } });
      }
      throw new ApiError(409, `${item.name} sold out while you were checking out. Nothing was charged.`);
    }
    decremented.push(item);
  }

  let order;
  try {
    const pointsEarned = pointsEarnedFor(grandTotal);

    order = await Order.create({
      user: req.user._id,
      items,
      shipping: {
        name: shipping.name.trim(),
        phone: String(shipping.phone).trim(),
        email: shipping.email.toLowerCase().trim(),
        address: shipping.address.trim(),
        landmark: shipping.landmark ? shipping.landmark.trim() : '',
        city: shipping.city.trim(),
        state: shipping.state.trim(),
        pincode: String(shipping.pincode).trim(),
      },
      payment: paymentRecord,
      itemsTotal,
      shippingFee,
      pointsUsed: redemption.pointsUsed,
      pointsDiscount: redemption.discount,
      pointsEarned,
      grandTotal,
      status: 'Order Placed',
    });

    // Spend redeemed points, credit earned ones.
    req.user.points = req.user.points - redemption.pointsUsed + pointsEarned;
    await req.user.save();

    // Empty the cart only after the order is safely written.
    await Cart.updateOne({ user: req.user._id }, { $set: { items: [] } });
  } catch (err) {
    // Order write failed — put the stock back so it isn't silently lost.
    for (const done of decremented) {
      await Product.updateOne({ _id: done.product }, { $inc: { stock: done.quantity } });
    }
    throw err;
  }

  res.status(201).json({
    success: true,
    message: 'Order placed successfully.',
    order,
    pointsBalance: req.user.points,
  });
});

/**
 * GET /api/orders
 * Private — the logged-in user's own order history, newest first.
 */
const getMyOrders = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);

  const [orders, total] = await Promise.all([
    Order.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Order.countDocuments({ user: req.user._id }),
  ]);

  res.json({
    success: true,
    count: orders.length,
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
    orders,
  });
});

/**
 * GET /api/orders/:id
 * Private — accepts the Mongo _id or the human "ASP-..." orderId.
 */
const getOrderById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);

  const order = await Order.findOne(
    isObjectId ? { _id: id } : { orderId: id.toUpperCase() }
  ).lean();

  if (!order) throw new ApiError(404, 'Order not found.');

  // Ownership check. Without this, changing the id in the URL would let
  // any logged-in user read anyone else's address and phone number.
  const isOwner = order.user.toString() === req.user._id.toString();
  if (!isOwner && req.user.role !== 'admin') {
    throw new ApiError(403, 'You do not have access to that order.');
  }

  res.json({ success: true, order });
});

/**
 * PUT /api/orders/:id/cancel
 * Private — allowed only before the parcel ships.
 */
const cancelOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);

  const order = await Order.findOne(isObjectId ? { _id: id } : { orderId: id.toUpperCase() });
  if (!order) throw new ApiError(404, 'Order not found.');

  if (order.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw new ApiError(403, 'You do not have access to that order.');
  }

  const cancellable = ['Order Placed', 'Payment Verified', 'Being Packed'];
  if (!cancellable.includes(order.status)) {
    throw new ApiError(400, `An order that is "${order.status}" can no longer be cancelled.`);
  }

  // Return stock to the shelf.
  for (const item of order.items) {
    if (item.product) {
      await Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } });
    }
  }

  // Refund redeemed points, claw back the points the purchase earned.
  if (order.pointsUsed || order.pointsEarned) {
    req.user.points = Math.max(0, req.user.points + order.pointsUsed - order.pointsEarned);
    await req.user.save();
  }

  order.status = 'Cancelled';
  order.cancelledAt = new Date();
  order.payment.status = order.payment.status === 'paid' ? 'refunded' : 'failed';
  order.statusHistory.push({
    status: 'Cancelled',
    note: req.body.reason || 'Cancelled by customer',
    at: new Date(),
  });
  await order.save();

  res.json({
    success: true,
    message: 'Order cancelled. Any points used have been returned.',
    order,
    pointsBalance: req.user.points,
  });
});

/** GET /api/orders/summary/points — Private. Feeds the points dashboard. */
const getPointsSummary = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id })
    .select('orderId createdAt pointsEarned pointsUsed grandTotal status')
    .sort({ createdAt: -1 })
    .lean();

  const history = orders.flatMap((o) => {
    const rows = [];
    if (o.pointsEarned > 0) {
      rows.push({ date: o.createdAt, reason: `Purchase ${o.orderId}`, points: o.pointsEarned, type: 'earned' });
    }
    if (o.pointsUsed > 0) {
      rows.push({ date: o.createdAt, reason: `Redeemed on ${o.orderId}`, points: -o.pointsUsed, type: 'spent' });
    }
    return rows;
  });

  res.json({
    success: true,
    points: req.user.points,
    worth: pointsToRupees(req.user.points),
    subscribedToNewsletter: req.user.subscribedToNewsletter,
    memberSince: req.user.createdAt,
    history,
  });
});

module.exports = { createOrder, getMyOrders, getOrderById, cancelOrder, getPointsSummary };
