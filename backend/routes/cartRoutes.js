const express = require('express');
const router = express.Router();
const {
  getCart, addToCart, updateCartItem, removeFromCart, clearCart, mergeCart,
} = require('../controllers/cartController');
const { protect } = require('../middleware/authMiddleware');

// Every cart route requires a logged-in user.
router.use(protect);

router.get('/', getCart);
router.post('/', addToCart);
router.post('/merge', mergeCart);
router.delete('/', clearCart);
router.put('/:productId', updateCartItem);
router.delete('/:productId', removeFromCart);

module.exports = router;
