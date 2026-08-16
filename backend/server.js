const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const cartRoutes = require('./routes/cartRoutes');
const wishlistRoutes = require('./routes/wishlistRoutes');
const orderRoutes = require('./routes/orderRoutes');
const contactRoutes = require('./routes/contactRoutes');
const adminRoutes = require('./routes/adminRoutes');
const paymentRoutes = require('./routes/paymentRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

/* ─────────── Database ─────────── */
connectDB();

/* ─────────── Core middleware ─────────── */

// Body parsers. The 1mb cap stops a huge payload from exhausting memory.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// CORS. Reads a comma-separated allowlist from .env rather than using
// `cors()` wide open, because a wide-open API can be called from any
// site on the internet using your visitors' credentials.
const allowedOrigins = (
  process.env.CLIENT_URLS ||
  'http://localhost:5500,http://127.0.0.1:5500,http://localhost:5000,http://127.0.0.1:5000,https://asp-perfume.onrender.com'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // `!origin` covers curl, Postman and same-origin requests.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Throttle auth endpoints specifically — these are the ones worth
// brute-forcing. 20 attempts per 15 min per IP is generous for a human
// and useless for a script.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
});

/* ─────────── Serve the frontend ─────────── */
// This makes http://localhost:5000 serve index.html directly, so you can run
// the whole site from a single process if you want. Serving it separately on
// Live Server also works — that is what CLIENT_URLS is for.
app.use(express.static(path.join(__dirname, '..', 'frontend')));

/* ─────────── API routes ─────────── */
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Asp Perfume API is running',
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentRoutes);

// Legacy aliases. Your original index.html called these two paths directly;
// keeping them means that code works unchanged if you re-enable it.
app.post('/api/create-order', (req, res, next) => {
  req.url = '/create-order';
  paymentRoutes(req, res, next);
});
app.post('/api/verify-payment', (req, res, next) => {
  req.url = '/verify';
  paymentRoutes(req, res, next);
});

/* ─────────── Errors ─────────── */
app.use('/api', notFound);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`\n  Asp Perfume API`);
  console.log(`  Mode:      ${process.env.NODE_ENV || 'development'}`);
  console.log(`  API:       http://localhost:${PORT}/api`);
  console.log(`  Storefront: http://localhost:${PORT}`);
  console.log(`  CORS allow: ${allowedOrigins.join(', ')}\n`);
});

// Without this, an unhandled rejection leaves the process alive but broken.
process.on('unhandledRejection', (err) => {
  console.error(`[fatal] Unhandled rejection: ${err.message}`);
  server.close(() => process.exit(1));
});

module.exports = app;
