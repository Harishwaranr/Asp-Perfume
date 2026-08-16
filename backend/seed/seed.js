/**
 * Seeds the database.
 *
 *   npm run seed            -> wipe products/users/carts/wishlists, insert fresh
 *   npm run seed:destroy    -> wipe everything, insert nothing
 *
 * The first three products are byte-for-byte your original hardcoded cards,
 * including the exact Unsplash URLs and note breakdowns. Where the card
 * data-* attributes and the allProducts array disagreed in your original
 * file, the card version wins — it was the one actually rendered.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const Product = require('../models/Product');
const User = require('../models/User');
const Cart = require('../models/Cart');
const Wishlist = require('../models/Wishlist');
const Order = require('../models/Order');
const Contact = require('../models/Contact');

const products = [
  /* ── Your three original fragrances ── */
  {
    name: 'Midnight Noir',
    description:
      'Deep smoky oud, black amber, and dark musk — an addictive trail that lingers long into the night.',
    price: 2499,
    size: '50ml',
    image: 'https://images.unsplash.com/photo-1588405748880-12d1d2a59f75?w=600&q=80',
    category: 'Oriental',
    tag: 'Bestseller',
    notes: {
      top: 'Black Pepper, Bergamot, Cardamom',
      heart: 'Oud Wood, Smoky Amber, Leather',
      base: 'Dark Musk, Patchouli, Vetiver',
    },
    longevity: '12–16 hours',
    sillage: 'Heavy',
    occasion: 'Evening, Night Out, Special Events',
    season: 'Autumn, Winter',
    stock: 25,
    sortOrder: 1,
    rating: 4.8,
    numReviews: 142,
  },
  {
    name: 'Rose Bloom',
    description:
      'Delicate Bulgarian rose entwined with soft sandalwood and whispers of jasmine — radiant and timeless.',
    price: 1899,
    size: '75ml',
    image: 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?w=600&q=80',
    category: 'Floral',
    tag: '',
    notes: {
      top: 'Bulgarian Rose, Peony, Fresh Greens',
      heart: 'Sandalwood, Jasmine Absolute, Iris',
      base: 'White Musk, Ambergris, Cedarwood',
    },
    longevity: '8–10 hours',
    sillage: 'Moderate',
    occasion: 'Day, Office, Romantic Evenings',
    season: 'Spring, Summer',
    stock: 30,
    sortOrder: 2,
    rating: 4.6,
    numReviews: 98,
  },
  {
    name: 'Citrus Dawn',
    description: 'Bergamot, Sicilian lemon, and sea salt — a sparkling burst of morning energy.',
    price: 1499,
    size: '75ml',
    image: 'https://images.unsplash.com/photo-1563170351-be82bc888aa4?w=600&q=80',
    category: 'Citrus',
    tag: '',
    notes: {
      top: 'Bergamot, Sicilian Lemon, Sea Salt',
      heart: 'White Tea, Neroli, Aquatic Accord',
      base: 'Driftwood, White Musk, Amber',
    },
    longevity: '6–8 hours',
    sillage: 'Light to Moderate',
    occasion: 'Morning, Casual, Office, Gym',
    season: 'Spring, Summer, All Year',
    stock: 40,
    sortOrder: 3,
    rating: 4.4,
    numReviews: 76,
  },

  /* ── Three extra fragrances, using the images you uploaded ── */
  {
    name: 'Black Element',
    description:
      'Serpentine and severe — charred vetiver coiled around black leather and cold stone. Wear it when you intend to be remembered.',
    price: 3299,
    size: '100ml',
    image: 'images/black-element.jpg',
    category: 'Woody',
    tag: 'New',
    notes: {
      top: 'Pink Peppercorn, Elemi, Grapefruit Zest',
      heart: 'Charred Vetiver, Black Leather, Cypress',
      base: 'Labdanum, Ambroxan, Volcanic Stone Accord',
    },
    longevity: '14–18 hours',
    sillage: 'Very Heavy',
    occasion: 'Evening, Formal, Statement Wear',
    season: 'Autumn, Winter',
    stock: 12,
    sortOrder: 4,
    rating: 4.9,
    numReviews: 31,
  },
  {
    name: 'Moonkissed Drama',
    description:
      'Iridescent and unruly — sugared plum crashing into violet smoke and cold vanilla. Built for nights that go off-script.',
    price: 2199,
    size: '75ml',
    image: 'images/moonkissed-drama.jpg',
    category: 'Gourmand',
    tag: '',
    notes: {
      top: 'Sugared Plum, Blackcurrant, Pear Nectar',
      heart: 'Violet Petals, Orris, Heliotrope',
      base: 'Cold Vanilla, Tonka Bean, Soft Musk',
    },
    longevity: '9–12 hours',
    sillage: 'Moderate to Heavy',
    occasion: 'Night Out, Parties, Date Night',
    season: 'Autumn, Winter, Spring',
    stock: 22,
    sortOrder: 5,
    rating: 4.5,
    numReviews: 54,
  },
  {
    name: 'Violet Hour',
    description:
      'That last blue-violet minute before dusk — lavender absolute over warm amber and clean skin musk.',
    price: 1699,
    size: '50ml',
    image: 'images/violet-hour.jpg',
    category: 'Fresh',
    tag: '',
    notes: {
      top: 'Lavender Absolute, Bergamot, Green Mandarin',
      heart: 'Violet Leaf, Clary Sage, Blue Iris',
      base: 'Warm Amber, Skin Musk, Blond Woods',
    },
    longevity: '7–9 hours',
    sillage: 'Light to Moderate',
    occasion: 'Day, Office, Everyday Wear',
    season: 'All Year',
    stock: 35,
    sortOrder: 6,
    rating: 4.3,
    numReviews: 41,
  },
];

async function run() {
  await connectDB();

  const destroyOnly = process.argv.includes('--destroy');

  console.log('[seed] Clearing existing data...');
  await Promise.all([
    Product.deleteMany({}),
    User.deleteMany({}),
    Cart.deleteMany({}),
    Wishlist.deleteMany({}),
    Order.deleteMany({}),
    Contact.deleteMany({}),
  ]);

  if (destroyOnly) {
    console.log('[seed] All collections emptied. Nothing inserted.');
    await mongoose.connection.close();
    process.exit(0);
  }

  console.log('[seed] Inserting products...');
  const created = await Product.create(products);
  console.log(`[seed] ${created.length} products inserted.`);

  // Credentials come from .env so they never sit in version control.
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@aspperfume.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminPassword) {
    console.warn(
      '\n[seed] SEED_ADMIN_PASSWORD is not set in .env — no admin account was created.' +
        '\n[seed] Add it and run `npm run seed` again to get an admin login.\n'
    );
  } else {
    // Created via .create() (not insertMany) so the pre-save hash hook fires.
    const admin = await User.create({
      name: 'Asp Perfume Admin',
      email: adminEmail,
      password: adminPassword,
      role: 'admin',
      points: 0,
    });
    await Cart.create({ user: admin._id, items: [] });
    await Wishlist.create({ user: admin._id, products: [] });
    console.log(`[seed] Admin created: ${admin.email}`);
  }

  // A throwaway shopper so you can test the customer flow immediately.
  if (process.env.SEED_DEMO_PASSWORD) {
    const demo = await User.create({
      name: 'Demo Shopper',
      email: 'demo@aspperfume.com',
      password: process.env.SEED_DEMO_PASSWORD,
      phone: '9876543210',
      role: 'user',
      points: 600, // enough to test point redemption straight away
    });
    await Cart.create({ user: demo._id, items: [] });
    await Wishlist.create({ user: demo._id, products: [] });
    console.log(`[seed] Demo user created: ${demo.email} (600 points)`);
  }

  console.log('\n[seed] Done.\n');
  await mongoose.connection.close();
  process.exit(0);
}

run().catch(async (err) => {
  console.error('[seed] Failed:', err.message);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
