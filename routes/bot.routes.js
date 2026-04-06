const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const bot = require('../controllers/bot.controller');

router.post('/flow', protect, bot.saveFlow);
router.get('/flow', protect, bot.getFlow);

module.exports = router;
