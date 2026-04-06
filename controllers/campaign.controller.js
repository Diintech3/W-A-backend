const Campaign = require('../models/Campaign');
const Contact = require('../models/Contact');
const Template = require('../models/Template');
const Message = require('../models/Message');
const Analytics = require('../models/Analytics');
const { success, fail } = require('../utils/apiResponse');
const whatsapp = require('../services/whatsapp.service');
const { emitToUser } = require('../services/socket.service');

function templateParamsFromDoc(template) {
  const samples = template.sampleParams || [];
  if (!samples.length) return [];
  if (samples[0].key || samples[0].parameter_name) {
    return samples.map((s) => ({
      type: 'text',
      text: String(s.value ?? ''),
      parameter_name: s.key || s.parameter_name,
    }));
  }
  return samples.map((s) => String(s.value ?? s.text ?? ''));
}

async function upsertAnalyticsDay(userId, patch) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  await Analytics.findOneAndUpdate(
    { userId, date: start },
    { $inc: patch },
    { upsert: true, new: true }
  );
}

async function runCampaignSendJob(campaignId, userId) {
  const campaign = await Campaign.findOne({ _id: campaignId, userId });
  if (!campaign) return;

  if (campaign.status === 'scheduled') {
    campaign.status = 'running';
    await campaign.save();
  }

  if (campaign.status !== 'running') return;

  const template = await Template.findOne({ _id: campaign.template, userId });
  if (!template) {
    campaign.status = 'failed';
    await campaign.save();
    emitToUser(String(userId), 'campaign:progress', {
      campaignId: String(campaign._id),
      status: 'failed',
      error: 'Template missing',
    });
    return;
  }

  const contacts = await Contact.find({
    userId,
    group: { $in: [campaign.targetGroup] },
    optedOut: false,
  });

  campaign.totalContacts = contacts.length;
  await campaign.save();

  const params = templateParamsFromDoc(template);
  let sent = campaign.sent || 0;
  let delivered = campaign.delivered || 0;
  let read = campaign.read || 0;
  let failed = campaign.failed || 0;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const phone = contact.phone.replace(/\D/g, '');
    const msgDoc = await Message.create({
      userId,
      campaignId: campaign._id,
      direction: 'outbound',
      from: 'business',
      to: phone,
      body: `${template.whatsappTemplateName} (${template.name})`,
      type: 'template',
      status: 'pending',
    });

    try {
      const apiRes = await whatsapp.sendTemplateMessage(
        userId,
        phone,
        template.whatsappTemplateName,
        template.languageCode || 'en',
        params
      );
      const wamid = apiRes?.messages?.[0]?.id || '';
      msgDoc.status = 'sent';
      msgDoc.whatsappMessageId = wamid;
      await msgDoc.save();
      sent += 1;
      await upsertAnalyticsDay(userId, { sent: 1 });
    } catch (err) {
      msgDoc.status = 'failed';
      msgDoc.errorReason = err.response?.data?.error?.message || err.message || 'Send failed';
      await msgDoc.save();
      failed += 1;
      await upsertAnalyticsDay(userId, { failed: 1 });
    }

    campaign.sent = sent;
    campaign.failed = failed;
    campaign.delivered = delivered;
    campaign.read = read;
    await campaign.save();

    emitToUser(String(userId), 'campaign:progress', {
      campaignId: String(campaign._id),
      processed: i + 1,
      total: contacts.length,
      sent,
      failed,
    });
  }

  campaign.status = 'completed';
  campaign.sent = sent;
  campaign.failed = failed;
  await campaign.save();

  emitToUser(String(userId), 'campaign:progress', {
    campaignId: String(campaign._id),
    status: 'completed',
    total: contacts.length,
    sent,
    failed,
  });
}

exports.runCampaignSendJob = runCampaignSendJob;

exports.createCampaign = async (req, res) => {
  try {
    const { name, targetGroup, template, scheduledAt } = req.body;
    if (!name || !targetGroup || !template) {
      return fail(res, 'Name, target group and template are required');
    }

    let status = 'draft';
    let scheduleDate = null;
    if (scheduledAt) {
      scheduleDate = new Date(scheduledAt);
      if (scheduleDate > new Date()) status = 'scheduled';
    }

    const campaign = await Campaign.create({
      userId: req.user._id,
      name,
      targetGroup,
      template,
      status,
      scheduledAt: status === 'scheduled' ? scheduleDate : null,
    });

    return success(res, { campaign }, 'Campaign created', 201);
  } catch (e) {
    return fail(res, e.message || 'Failed to create campaign', 500);
  }
};

exports.listCampaigns = async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.user._id }).sort({ createdAt: -1 });
    return success(res, { campaigns }, 'Campaigns');
  } catch (e) {
    return fail(res, e.message || 'Failed to list campaigns', 500);
  }
};

exports.getCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id });
    if (!campaign) return fail(res, 'Campaign not found', 404);

    const messages = await Message.find({ campaignId: campaign._id })
      .sort({ createdAt: -1 })
      .limit(500);

    return success(res, { campaign, messages }, 'Campaign detail');
  } catch (e) {
    return fail(res, e.message || 'Failed to load campaign', 500);
  }
};

exports.deleteCampaign = async (req, res) => {
  try {
    const c = await Campaign.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!c) return fail(res, 'Campaign not found', 404);
    await Message.deleteMany({ campaignId: c._id });
    return success(res, null, 'Campaign deleted');
  } catch (e) {
    return fail(res, e.message || 'Failed to delete', 500);
  }
};

exports.sendCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id });
    if (!campaign) return fail(res, 'Campaign not found', 404);

    if (campaign.status === 'running') {
      return fail(res, 'Campaign is already running');
    }

    campaign.status = 'running';
    campaign.scheduledAt = null;
    await campaign.save();

    emitToUser(String(req.user._id), 'campaign:progress', {
      campaignId: String(campaign._id),
      status: 'started',
    });

    setImmediate(() => {
      runCampaignSendJob(campaign._id, req.user._id).catch((err) => {
        console.error('Campaign send error:', err);
      });
    });

    return success(res, { campaign }, 'Campaign send started');
  } catch (e) {
    return fail(res, e.message || 'Failed to start send', 500);
  }
};
