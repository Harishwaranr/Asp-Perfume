const ShippingSettings = require('../models/ShippingSettings');

async function getShippingSettings() {
  let settings = await ShippingSettings.findOne();

  if (!settings) {
    settings = await ShippingSettings.create({
      fee: 99,
      freeShippingThreshold: 1500,
      updatedBy: 'system',
      updatedAt: new Date(),
    });
  }

  return settings;
}

function getShippingFeeForItems(itemsTotal, settings) {
  const fee = Number(settings?.fee ?? 99);
  const threshold = Number(settings?.freeShippingThreshold ?? 1500);
  return itemsTotal >= threshold ? 0 : fee;
}

module.exports = { getShippingSettings, getShippingFeeForItems };
