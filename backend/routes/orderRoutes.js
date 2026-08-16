const express = require('express');
const router = express.Router();
const {
  createOrder, getMyOrders, getOrderById, cancelOrder, getPointsSummary,
} = require('../controllers/orderController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

// Declared before /:id so "summary" isn't swallowed as an order id.
router.get('/summary/points', getPointsSummary);

router.post('/', createOrder);
router.get('/', getMyOrders);
router.get('/:id', getOrderById);
router.put('/:id/cancel', cancelOrder);

module.exports = router;
