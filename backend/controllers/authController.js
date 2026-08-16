const User = require('../models/User');
const Cart = require('../models/Cart');
const Wishlist = require('../models/Wishlist');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const generateToken = require('../utils/generateToken');

/**
 * POST /api/auth/register
 * Public
 */
const register = asyncHandler(async (req, res) => {
  const { name, email, password, phone } = req.body;

  if (!name || !email || !password) {
    throw new ApiError(400, 'Name, email and password are all required.');
  }
  if (password.length < 8) {
    throw new ApiError(400, 'Password must be at least 8 characters long.');
  }

  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    throw new ApiError(409, 'An account with that email already exists. Try logging in.');
  }

  // NOTE: `role` is intentionally NOT read from req.body. If it were,
  // anyone could POST {"role":"admin"} and grant themselves the admin panel.
  const user = await User.create({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password,
    phone: phone ? phone.trim() : undefined,
  });

  // Give every new user an empty cart and wishlist up front so later
  // routes never have to handle a "no cart document yet" edge case.
  await Cart.create({ user: user._id, items: [] });
  await Wishlist.create({ user: user._id, products: [] });

  res.status(201).json({
    success: true,
    message: `Welcome to Asp Perfume, ${user.name}.`,
    token: generateToken(user),
    user: user.toPublicJSON(),
  });
});

/**
 * POST /api/auth/login
 * Public
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(400, 'Please provide both email and password.');
  }

  // `.select('+password')` is required because the schema hides it by default.
  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');

  // Deliberately identical message for "no such user" and "wrong password".
  // Distinguishing them lets an attacker enumerate which emails are registered.
  if (!user || !(await user.matchPassword(password))) {
    throw new ApiError(401, 'Invalid email or password.');
  }

  res.json({
    success: true,
    message: `Welcome back, ${user.name}.`,
    token: generateToken(user),
    user: user.toPublicJSON(),
  });
});

/**
 * GET /api/auth/me
 * Private — used by the frontend on page load to restore the session.
 */
const getMe = asyncHandler(async (req, res) => {
  res.json({ success: true, user: req.user.toPublicJSON() });
});

/**
 * PUT /api/auth/me
 * Private
 */
const updateMe = asyncHandler(async (req, res) => {
  const { name, phone } = req.body;
  const user = req.user;

  if (name !== undefined) user.name = name.trim();
  if (phone !== undefined) user.phone = phone.trim();

  await user.save();
  res.json({ success: true, message: 'Profile updated.', user: user.toPublicJSON() });
});

/**
 * PUT /api/auth/me/password
 * Private
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new ApiError(400, 'Both current and new password are required.');
  }
  if (newPassword.length < 8) {
    throw new ApiError(400, 'New password must be at least 8 characters.');
  }

  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.matchPassword(currentPassword))) {
    throw new ApiError(401, 'Your current password is incorrect.');
  }

  user.password = newPassword; // pre('save') hook re-hashes it
  await user.save();

  // Issue a fresh token so the old one is effectively rotated out.
  res.json({ success: true, message: 'Password changed.', token: generateToken(user) });
});

module.exports = { register, login, getMe, updateMe, changePassword };
