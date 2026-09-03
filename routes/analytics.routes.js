const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const clientScope = require('../middleware/clientScope.middleware');
const analytics = require('../controllers/analytics.controller');

router.get('/overview', protect, clientScope, analytics.overview);
router.get('/campaigns', protect, clientScope, analytics.campaignStats);
router.get('/drip', protect, clientScope, analytics.dripAnalytics);
router.get('/timeline', protect, clientScope, analytics.timeline);

module.exports = router;
