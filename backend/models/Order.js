const mongoose = require('mongoose');

/**
 * ORDER_STATUSES intentionally mirrors the `trackerSteps` array already in
 * your index.html, so the existing #tracker-overlay renders correctly without
 * any mapping layer. If you add a status here, add the matching step there.
 */
const ORDER_STATUSES = [
  'Order Placed',
  'Payment Verified',
  'Being Packed',
  'Shipped',
  'Out for Delivery',
  'Delivered',
  'Cancelled',
];

/**
 * Order line items are DENORMALISED on purpose: we copy name/price/size/image
 * into the order rather than only storing a ref. If an admin later renames a
 * product or changes its price, historical invoices must not silently change.
 * The `product` ref is kept too, for "buy it again" links.
 */
const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: { type: String, required: true },
    size: { type: String, default: '' },
    image: { type: String, default: '' },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    subtotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const shippingSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: {
      type: String,
      required: true,
      match: [/^[6-9]\d{9}$/, 'Please provide a valid 10-digit Indian mobile number'],
    },
    email: { type: String, required: true, lowercase: true },
    address: { type: String, required: true },
    landmark: { type: String, default: '' },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: {
      type: String,
      required: true,
      match: [/^\d{6}$/, 'Please provide a valid 6-digit pincode'],
    },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    // Human-readable ID, same "ASP-XXXXXXXX" shape your frontend already shows
    orderId: { type: String, unique: true, index: true },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    items: {
      type: [orderItemSchema],
      validate: [(v) => v.length > 0, 'An order must contain at least one item'],
    },
    shipping: { type: shippingSchema, required: true },

    payment: {
      method: {
        type: String,
        enum: ['upi', 'card', 'netbank', 'cod'],
        required: true,
      },
      status: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refunded'],
        default: 'pending',
      },
      // For UPI we store the VPA; for card ONLY the last 4 digits.
      // Full PANs / CVVs are never accepted or persisted by this API.
      reference: { type: String, default: '' },
      paidAt: Date,
    },

    itemsTotal: { type: Number, required: true, min: 0 },
    shippingFee: { type: Number, default: 0, min: 0 },
    pointsUsed: { type: Number, default: 0, min: 0 },
    pointsDiscount: { type: Number, default: 0, min: 0 },
    pointsEarned: { type: Number, default: 0, min: 0 },
    grandTotal: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: ORDER_STATUSES,
      default: 'Order Placed',
      index: true,
    },
    statusHistory: [
      {
        status: { type: String, enum: ORDER_STATUSES },
        note: { type: String, default: '' },
        at: { type: Date, default: Date.now },
        _id: false,
      },
    ],
    cancelledAt: Date,
    deliveredAt: Date,
  },
  { timestamps: true }
);

/** Generate ASP-XXXXXXXX and seed the status history on first save. */
orderSchema.pre('validate', function (next) {
  if (!this.orderId) {
    const stamp = Date.now().toString().slice(-6);
    const rand = Math.floor(Math.random() * 90 + 10); // 2 random digits
    this.orderId = `ASP-${stamp}${rand}`;
  }
  if (!this.statusHistory || this.statusHistory.length === 0) {
    this.statusHistory = [{ status: this.status, note: 'Order received', at: new Date() }];
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
module.exports.ORDER_STATUSES = ORDER_STATUSES;
