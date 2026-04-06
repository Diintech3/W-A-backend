const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const analytics = require('../controllers/analytics.controller');

router.get('/overview', protect, analytics.overview);
router.get('/campaigns', protect, analytics.campaignStats);
router.get('/timeline', protect, analytics.timeline);

module.exports = router;
