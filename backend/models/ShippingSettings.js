const mongoose = require('mongoose');

const shippingSettingsSchema = new mongoose.Schema(
  {
    fee: {
      type: Number,
      required: true,
      min: 0,
      default: 99,
    },
    freeShippingThreshold: {
      type: Number,
      required: true,
      min: 0,
      default: 1500,
    },
    updatedBy: {
      type: String,
      default: 'system',
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ShippingSettings', shippingSettingsSchema);
