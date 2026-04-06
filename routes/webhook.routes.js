const express = require('express');
const router = express.Router();
const webhook = require('../controllers/webhook.controller');

router.get('/', webhook.verifyWebhook);
router.post('/', webhook.receiveWebhook);

module.exports = router;
