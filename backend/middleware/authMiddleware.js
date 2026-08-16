const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

/**
 * `protect` — rejects the request unless a valid JWT is present.
 *
 * We re-fetch the user from the database on every request rather than
 * trusting the token payload. It costs one query, but it means a deleted
 * or demoted user cannot keep acting on an old token until it expires.
 */
const protect = asyncHandler(async (req, res, next) => {
  let token;
  const header = req.headers.authorization;

  if (header && header.startsWith('Bearer ')) {
    token = header.split(' ')[1];
  }

  if (!token) {
    throw new ApiError(401, 'Not authorised. Please log in.');
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new ApiError(401, 'Your session has expired. Please log in again.');
    }
    throw new ApiError(401, 'Invalid token. Please log in again.');
  }

  const user = await User.findById(decoded.id);
  if (!user) {
    throw new ApiError(401, 'The user for this token no longer exists.');
  }

  req.user = user;
  next();
});

/**
 * `optionalAuth` — attaches req.user if a valid token is present,
 * but never rejects. Used on routes that behave differently for
 * guests vs logged-in visitors (e.g. the contact form).
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();

  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (user) req.user = user;
  } catch (_) {
    // Deliberately swallowed — a bad token on an optional route is just a guest.
  }
  next();
});

/** `adminOnly` — must be chained AFTER protect. */
const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return next(new ApiError(403, 'Admin access required.'));
  }
  next();
};

module.exports = { protect, optionalAuth, adminOnly };
