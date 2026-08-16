const mongoose = require('mongoose');

/**
 * Backs both the new feedback form and the existing newsletter signup
 * in the #contact section. `type` distinguishes them so admin can filter.
 */
const contactSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 60 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    phone: { type: String, trim: true },
    subject: { type: String, trim: true, maxlength: 120, default: 'General Enquiry' },
    message: { type: String, trim: true, maxlength: 2000 },
    type: {
      type: String,
      enum: ['contact', 'feedback', 'newsletter'],
      default: 'contact',
      index: true,
    },
    status: {
      type: String,
      enum: ['new', 'read', 'resolved'],
      default: 'new',
      index: true,
    },
    // Set when a logged-in user submits; null for anonymous visitors
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    adminNote: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Contact', contactSchema);
