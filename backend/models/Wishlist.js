const mongoose = require('mongoose');

/**
 * One wishlist per user. Kept as a flat array of product refs because the
 * frontend only needs "is this product wished: yes/no" plus a list to render
 * in #wishlist-overlay. No quantities, no ordering requirements.
 */
const wishlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Wishlist', wishlistSchema);
