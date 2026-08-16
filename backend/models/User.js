const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, default: 'Home' },
    name: String,
    phone: String,
    address: String,
    landmark: String,
    city: String,
    state: String,
    pincode: String,
    isDefault: { type: Boolean, default: false },
  },
  { _id: true }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [60, 'Name cannot exceed 60 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      // select:false means password is NEVER returned by a normal find().
      // We have to explicitly ask for it during login.
      select: false,
    },
    phone: {
      type: String,
      trim: true,
      match: [/^[6-9]\d{9}$/, 'Please provide a valid 10-digit Indian mobile number'],
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    // Loyalty points — matches the frontend's "1 point = Rs.0.10" scheme
    points: { type: Number, default: 0, min: 0 },
    subscribedToNewsletter: { type: Boolean, default: false },
    addresses: [addressSchema],
  },
  { timestamps: true }
);

/**
 * Hash the password before saving.
 * The `isModified` guard is important: without it, every profile update
 * would re-hash the already-hashed password and lock the user out.
 */
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

/** Shape sent to the client. Never includes the password hash. */
userSchema.methods.toPublicJSON = function () {
  return {
    _id: this._id,
    name: this.name,
    email: this.email,
    phone: this.phone,
    role: this.role,
    points: this.points,
    subscribedToNewsletter: this.subscribedToNewsletter,
    addresses: this.addresses,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
