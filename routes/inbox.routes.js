const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const inbox = require('../controllers/inbox.controller');

router.get('/conversations', protect, inbox.listConversations);
router.get('/conversations/:id/messages', protect, inbox.getMessages);
router.post('/conversations/:id/reply', protect, inbox.reply);
router.patch('/conversations/:id/assign', protect, inbox.assign);

module.exports = router;
