const crypto = require('crypto');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Cart = require('../models/Cart');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { loadCart } = require('./cartController');
const { calculateRedemption, pointsEarnedFor } = require('../utils/points');

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  RAZORPAY — OPTIONAL REAL PAYMENT FLOW
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  Your index.html already contained client-side Razorpay scaffolding
 *  calling /api/create-order and /api/verify-payment. Those endpoints
 *  never existed, so the code silently fell into its own "demo mode".
 *  This controller implements them properly.
 *
 *  Two things in the original client code were unsafe and are fixed here:
 *
 *  1. FAIL-OPEN VERIFICATION. The old handler did:
 *         catch(e){ onSuccess(response); }
 *     i.e. if the verify request errored, the order was treated as paid.
 *     Anyone could have blocked that one request and got free product.
 *     Verification now happens server-side and an order is only marked
 *     paid on a valid HMAC signature.
 *
 *  2. CLIENT-SUPPLIED AMOUNT. The old code posted `amount` from the
 *     browser. The amount is now computed server-side from the user's
 *     cart; the client cannot influence what it is charged.
 *
 *  If RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are absent from .env, these
 *  routes return 503 with a clear message rather than half-working.
 * ═══════════════════════════════════════════════════════════════════════
 */

const FREE_SHIPPING_THRESHOLD = 1500;
const SHIPPING_FEE = 99;

function isConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

/** Calls Razorpay's REST API directly — avoids pulling in another dependency. */
async function razorpayRequest(path, body) {
  const auth = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
  ).toString('base64');

  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new ApiError(502, data?.error?.description || 'Razorpay request failed.');
  }
  return data;
}

/**
 * GET /api/payments/config
 * Public — lets the frontend decide whether to show the Razorpay flow.
 * Returns the PUBLIC key id only. The secret never leaves the server.
 */
const getConfig = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    razorpayEnabled: isConfigured(),
    keyId: isConfigured() ? process.env.RAZORPAY_KEY_ID : null,
  });
});

/**
 * POST /api/payments/create-order   (alias: POST /api/create-order)
 * Private
 * Body: { shipping:{...}, pointsToRedeem? }
 *
 * Creates a PENDING order in our database plus a matching Razorpay order,
 * and returns the ids the checkout widget needs. Stock is NOT decremented
 * here — that happens on verified payment, so an abandoned checkout does
 * not hold inventory hostage.
 */
const createRazorpayOrder = asyncHandler(async (req, res) => {
  if (!isConfigured()) {
    throw new ApiError(503, 'Razorpay is not configured on this server. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env.');
  }

  const { shipping, pointsToRedeem = 0 } = req.body;
  if (!shipping) throw new ApiError(400, 'Shipping details are required.');

  const required = ['name', 'phone', 'email', 'address', 'city', 'state', 'pincode'];
  const missing = required.filter((f) => !shipping[f] || !String(shipping[f]).trim());
  if (missing.length) throw new ApiError(400, `Missing shipping fields: ${missing.join(', ')}`);

  const cart = await loadCart(req.user._id);
  if (!cart.items.length) throw new ApiError(400, 'Your cart is empty.');

  // Amount is derived from the database, never from the request body.
  const items = [];
  let itemsTotal = 0;

  for (const line of cart.items) {
    const p = line.product;
    if (!p || !p.isActive) throw new ApiError(409, `"${p?.name || 'An item'}" is no longer available.`);
    if (p.stock < line.quantity) throw new ApiError(409, `Only ${p.stock} units of ${p.name} remain.`);

    const subtotal = p.price * line.quantity;
    itemsTotal += subtotal;
    items.push({
      product: p._id, name: p.name, size: p.size, image: p.image,
      price: p.price, quantity: line.quantity, subtotal,
    });
  }

  const redemption = calculateRedemption(pointsToRedeem, req.user.points, itemsTotal);
  if (redemption.reason && Number(pointsToRedeem) > 0) throw new ApiError(400, redemption.reason);

  const shippingFee = itemsTotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
  const grandTotal = Math.max(1, itemsTotal - redemption.discount + shippingFee);

  const order = await Order.create({
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
    payment: { method: 'card', status: 'pending', reference: '' },
    itemsTotal,
    shippingFee,
    pointsUsed: redemption.pointsUsed,
    pointsDiscount: redemption.discount,
    pointsEarned: 0,
    grandTotal,
    status: 'Order Placed',
  });

  const rzp = await razorpayRequest('/orders', {
    amount: Math.round(grandTotal * 100), // paise
    currency: 'INR',
    receipt: order.orderId,
    notes: { aspOrderId: order.orderId, userId: req.user._id.toString() },
  });

  order.payment.reference = rzp.id;
  await order.save();

  res.status(201).json({
    success: true,
    order_id: rzp.id,                 // key names kept for the existing client code
    key_id: process.env.RAZORPAY_KEY_ID,
    amount: rzp.amount,
    currency: rzp.currency,
    aspOrderId: order.orderId,
  });
});

/**
 * POST /api/payments/verify   (alias: POST /api/verify-payment)
 * Private
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 *
 * The signature is HMAC-SHA256 of "<order_id>|<payment_id>" keyed with the
 * secret. Only Razorpay and this server know that secret, so a valid
 * signature is proof the payment genuinely happened.
 */
const verifyRazorpayPayment = asyncHandler(async (req, res) => {
  if (!isConfigured()) throw new ApiError(503, 'Razorpay is not configured on this server.');

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new ApiError(400, 'razorpay_order_id, razorpay_payment_id and razorpay_signature are all required.');
  }

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  // timingSafeEqual instead of === so the comparison cannot be timed.
  const a = Buffer.from(expected);
  const b = Buffer.from(String(razorpay_signature));
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);

  const order = await Order.findOne({ 'payment.reference': razorpay_order_id });
  if (!order) throw new ApiError(404, 'No matching order found for that payment.');

  if (order.user.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'That order does not belong to you.');
  }

  if (!valid) {
    order.payment.status = 'failed';
    order.status = 'Cancelled';
    order.statusHistory.push({ status: 'Cancelled', note: 'Payment signature verification failed', at: new Date() });
    await order.save();
    // 400, not 200-with-verified:false — a failed verification is an error.
    throw new ApiError(400, 'Payment verification failed. You have not been charged for this order.');
  }

  // Idempotency: Razorpay can fire the handler more than once.
  if (order.payment.status === 'paid') {
    return res.json({ success: true, verified: true, message: 'Payment already verified.', order });
  }

  // Payment is genuine — now commit the stock.
  const decremented = [];
  for (const item of order.items) {
    const ok = await Product.findOneAndUpdate(
      { _id: item.product, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity } },
      { new: true }
    );
    if (!ok) {
      for (const done of decremented) {
        await Product.updateOne({ _id: done.product }, { $inc: { stock: done.quantity } });
      }
      // Payment succeeded but we cannot fulfil — flag for a manual refund
      // rather than silently keeping the money.
      order.status = 'Cancelled';
      order.payment.status = 'paid';
      order.statusHistory.push({
        status: 'Cancelled',
        note: `PAID BUT OUT OF STOCK (${item.name}) — refund required`,
        at: new Date(),
      });
      await order.save();
      throw new ApiError(409, `${item.name} sold out during payment. A refund will be issued.`);
    }
    decremented.push(item);
  }

  const pointsEarned = pointsEarnedFor(order.grandTotal);

  order.payment.status = 'paid';
  order.payment.paidAt = new Date();
  order.pointsEarned = pointsEarned;
  order.status = 'Payment Verified';
  order.statusHistory.push({ status: 'Payment Verified', note: `Razorpay payment ${razorpay_payment_id}`, at: new Date() });
  await order.save();

  req.user.points = req.user.points - order.pointsUsed + pointsEarned;
  await req.user.save();

  await Cart.updateOne({ user: req.user._id }, { $set: { items: [] } });

  res.json({
    success: true,
    verified: true,
    message: 'Payment verified and order confirmed.',
    order,
    pointsBalance: req.user.points,
  });
});

module.exports = { getConfig, createRazorpayOrder, verifyRazorpayPayment };
