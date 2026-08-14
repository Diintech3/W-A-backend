const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const clientScope = require('../middleware/clientScope.middleware');
const campaign = require('../controllers/campaign.controller');

router.post('/', protect, clientScope, campaign.createCampaign);
router.get('/', protect, clientScope, campaign.listCampaigns);
router.get('/:id', protect, clientScope, campaign.getCampaign);
router.patch('/:id', protect, campaign.updateCampaign);
router.post('/:id/send', protect, campaign.sendCampaign);
router.delete('/:id', protect, campaign.deleteCampaign);

module.exports = router;
