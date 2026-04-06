const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const campaign = require('../controllers/campaign.controller');

router.post('/', protect, campaign.createCampaign);
router.get('/', protect, campaign.listCampaigns);
router.get('/:id', protect, campaign.getCampaign);
router.post('/:id/send', protect, campaign.sendCampaign);
router.delete('/:id', protect, campaign.deleteCampaign);

module.exports = router;
