const express = require('express');
const router = express.Router();
const { getProducts, getCategories, getProductById } = require('../controllers/productController');

// NOTE: /categories MUST be declared before /:id, otherwise Express matches
// the literal string "categories" as an :id parameter and returns a 404.
router.get('/', getProducts);
router.get('/categories', getCategories);
router.get('/:id', getProductById);

module.exports = router;
