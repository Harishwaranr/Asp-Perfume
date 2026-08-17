const express = require('express');
const router = express.Router();
const { getPublicShippingSettings } = require('../controllers/adminController');

router.get('/settings', getPublicShippingSettings);

module.exports = router;
