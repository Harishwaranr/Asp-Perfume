const mongoose = require('mongoose');

/**
 * One cart document per user (enforced by unique index on `user`).
 *
 * Design note: we store a snapshot of the price at the time of adding
 * (`priceAtAdd`) but ALWAYS recompute totals from the live Product price
 * at checkout. The snapshot exists only so we can warn the user
 * "this item's price changed" — it is never trusted for billing.
 * Trusting a client-supplied or stale price is the classic e-commerce
 * price-tampering bug.
 */

const cartItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be at least 1'],
      max: [10, 'Maximum 10 units per item'],
      default: 1,
    },
    priceAtAdd: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    items: [cartItemSchema],
  },
  { timestamps: true }
);

/** Total unit count — this is the number your navbar "Cart (n)" shows. */
cartSchema.virtual('totalQuantity').get(function () {
  return this.items.reduce((sum, i) => sum + i.quantity, 0);
});

cartSchema.set('toJSON', { virtuals: true });
cartSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Cart', cartSchema);
