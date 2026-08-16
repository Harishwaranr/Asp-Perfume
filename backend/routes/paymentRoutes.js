const express = require('express');
const router = express.Router();
const { getConfig, createRazorpayOrder, verifyRazorpayPayment } = require('../controllers/paymentController');
const { protect } = require('../middleware/authMiddleware');

router.get('/config', getConfig);                     // public
router.post('/create-order', protect, createRazorpayOrder);
router.post('/verify', protect, verifyRazorpayPayment);

module.exports = router;
