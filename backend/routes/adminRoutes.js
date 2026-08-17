const express = require('express');
const router = express.Router();
const {
  listProducts, createProduct, updateProduct, deleteProduct,
  listOrders, updateOrderStatus,
  getShippingAdminSettings, updateShippingAdminSettings,
  listContacts, updateContact,
  listUsers, getStats,
} = require('../controllers/adminController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

// Order matters: authenticate first, then check the role.
router.use(protect, adminOnly);

router.get('/stats', getStats);

router.route('/products').get(listProducts).post(createProduct);
router.route('/products/:id').put(updateProduct).delete(deleteProduct);

router.get('/orders', listOrders);
router.put('/orders/:id/status', updateOrderStatus);

router.get('/shipping/settings', getShippingAdminSettings);
router.put('/shipping/settings', updateShippingAdminSettings);

router.get('/contacts', listContacts);
router.put('/contacts/:id', updateContact);

router.get('/users', listUsers);

module.exports = router;
