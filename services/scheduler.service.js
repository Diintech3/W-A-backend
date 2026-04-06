const cron = require('node-cron');
const Campaign = require('../models/Campaign');
const { runCampaignSendJob } = require('../controllers/campaign.controller');
const { info, error } = require('../utils/logger');

let started = false;

function initScheduler() {
  if (started) return;
  started = true;

  cron.schedule('* * * * *', async () => {
    const now = new Date();
    try {
      const due = await Campaign.find({
        status: 'scheduled',
        scheduledAt: { $lte: now },
      }).limit(10);

      for (const c of due) {
        await runCampaignSendJob(c._id, c.userId);
      }
    } catch (e) {
      error('Scheduler cycle failed', { reason: e.message });
    }
  });

  info('Campaign scheduler started');
}

module.exports = { initScheduler };
