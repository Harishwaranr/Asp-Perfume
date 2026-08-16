const Contact = require('../models/Contact');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { SIGNUP_BONUS } = require('../utils/points');

/**
 * POST /api/contact
 * Public (optionalAuth attaches req.user when logged in)
 * Body: { name?, email, phone?, subject?, message?, type? }
 */
const submitContact = asyncHandler(async (req, res) => {
  const { name, email, phone, subject, message, type = 'contact' } = req.body;

  if (!email) throw new ApiError(400, 'Email is required.');
  if (!['contact', 'feedback', 'newsletter'].includes(type)) {
    throw new ApiError(400, 'type must be contact, feedback or newsletter.');
  }
  // A newsletter signup is just an email; a real enquiry needs a message.
  if (type !== 'newsletter' && (!message || !message.trim())) {
    throw new ApiError(400, 'Please write a message.');
  }

  const entry = await Contact.create({
    name: name ? name.trim() : req.user?.name || '',
    email: email.toLowerCase().trim(),
    phone: phone ? phone.trim() : req.user?.phone || '',
    subject: subject ? subject.trim() : type === 'newsletter' ? 'Newsletter signup' : 'General Enquiry',
    message: message ? message.trim() : '',
    type,
    user: req.user ? req.user._id : null,
  });

  // Newsletter signup awards the 200-point bonus your UI advertises.
  // Guarded so a user cannot farm points by subscribing repeatedly.
  let pointsAwarded = 0;
  if (type === 'newsletter' && req.user && !req.user.subscribedToNewsletter) {
    req.user.subscribedToNewsletter = true;
    req.user.points += SIGNUP_BONUS;
    await req.user.save();
    pointsAwarded = SIGNUP_BONUS;
  }

  res.status(201).json({
    success: true,
    message:
      type === 'newsletter'
        ? 'You are on the list. Welcome to the Inner Circle.'
        : 'Thank you — we have received your message and will reply soon.',
    pointsAwarded,
    totalPoints: req.user ? req.user.points : null,
    submission: {
      _id: entry._id,
      email: entry.email,
      type: entry.type,
      createdAt: entry.createdAt,
    },
  });
});

module.exports = { submitContact };
