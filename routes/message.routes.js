const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const message = require('../controllers/message.controller');
const { mediaUpload } = require('../middleware/upload.middleware');

router.get('/', protect, message.listMessages);
router.post('/media', protect, mediaUpload.single('file'), message.sendMediaMessage);

module.exports = router;
