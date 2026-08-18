const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const clientScope = require('../middleware/clientScope.middleware');
const inbox = require('../controllers/inbox.controller');

router.get('/conversations', protect, clientScope, inbox.listConversations);
router.get('/conversations/:id/messages', protect, clientScope, inbox.getMessages);
router.post('/conversations/:id/reply', protect, clientScope, inbox.reply);
router.post('/send-template', protect, clientScope, inbox.sendTemplate);
router.patch('/conversations/:id/assign', protect, inbox.assign);
router.put('/conversations/:id/toggle-ai', protect, clientScope, inbox.toggleAiState);
router.put('/conversations/:id/mark-read', protect, clientScope, inbox.markRead);
router.put('/conversations/:id/resolve', protect, clientScope, inbox.resolve);

module.exports = router;
