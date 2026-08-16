const mongoose = require('mongoose');

/**
 * Every field here maps directly onto a data-* attribute that the existing
 * .product-card markup and openQuickView() already read. That is deliberate —
 * it means the original frontend functions keep working with zero changes.
 *
 *   name       -> data-name        size      -> data-size
 *   price      -> data-price       tag       -> data-tag
 *   image      -> data-img         notes.top -> data-top
 *   notes.heart-> data-heart       notes.base-> data-base
 *   description-> data-desc        longevity -> data-longevity
 *   sillage    -> data-sillage     occasion  -> data-occasion
 *   season     -> data-season
 */

const CATEGORIES = ['Woody', 'Floral', 'Citrus', 'Oriental', 'Fresh', 'Gourmand'];

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      unique: true,
      trim: true,
    },
    slug: { type: String, unique: true, index: true },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    // Optional strike-through price for "was Rs.X" displays
    compareAtPrice: { type: Number, min: 0 },
    size: { type: String, required: true, default: '50ml' },
    image: { type: String, required: [true, 'Product image is required'] },
    gallery: [String],

    category: {
      type: String,
      enum: {
        values: CATEGORIES,
        message: '{VALUE} is not a supported category',
      },
      required: true,
      index: true,
    },
    // Badge shown on the card, e.g. "Bestseller". Empty string = no badge.
    tag: { type: String, default: '', trim: true },

    notes: {
      top: { type: String, default: '' },
      heart: { type: String, default: '' },
      base: { type: String, default: '' },
    },

    longevity: { type: String, default: '' },
    sillage: { type: String, default: '' },
    occasion: { type: String, default: '' },
    season: { type: String, default: '' },

    stock: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true, index: true },
    // Controls ordering in the grid; lower shows first
    sortOrder: { type: Number, default: 100 },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    numReviews: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// Text index powers /api/products?search=... — one index across the fields
// a shopper would plausibly type into your existing #search-input.
productSchema.index({
  name: 'text',
  description: 'text',
  'notes.top': 'text',
  'notes.heart': 'text',
  'notes.base': 'text',
  category: 'text',
});

productSchema.pre('validate', function (next) {
  if (this.isModified('name') || !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  next();
});

productSchema.virtual('inStock').get(function () {
  return this.stock > 0;
});

productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Product', productSchema);
module.exports.CATEGORIES = CATEGORIES;
