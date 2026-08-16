const express = require('express');
const router = express.Router();
const {
  getWishlist, addToWishlist, removeFromWishlist, mergeWishlist,
} = require('../controllers/wishlistController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', getWishlist);
router.post('/', addToWishlist);
router.post('/merge', mergeWishlist);
router.delete('/:productId', removeFromWishlist);

module.exports = router;
