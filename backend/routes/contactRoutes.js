const express = require('express');
const router = express.Router();
const { submitContact } = require('../controllers/contactController');
const { optionalAuth } = require('../middleware/authMiddleware');

// Public, but optionalAuth links the submission to an account when possible.
router.post('/', optionalAuth, submitContact);

module.exports = router;
