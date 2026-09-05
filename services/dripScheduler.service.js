const cron = require('node-cron');
const DripCampaign = require('../models/DripCampaign');
const DripStep = require('../models/DripStep');
const DripEnrollment = require('../models/DripEnrollment');
const DripDeliveryLog = require('../models/DripDeliveryLog');
const Template = require('../models/Template');
const Contact = require('../models/Contact');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { emitToUser } = require('./socket.service');
const whatsapp = require('./whatsapp.service');
const { info, error } = require('../utils/logger');

let isRunning = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks if current time is within user's configured business hours in their timezone
 */
function isWithinBusinessHours(user) {
  // If business hours restriction is not explicitly enabled, allow 24/7 sending
  if (!user?.businessHours?.enabled) {
    return true;
  }
  const tz = user?.businessHours?.timezone || 'Asia/Kolkata';
  const startHour = user?.businessHours?.startHour ?? 0;
  const endHour = user?.businessHours?.endHour ?? 24;

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
    });
    const currentHour = parseInt(formatter.format(new Date()), 10);
    return currentHour >= startHour && currentHour < endHour;
  } catch (err) {
    return true;
  }
}

/**
 * Stale-lock recovery & Deduplication Cleaner
 */
async function cleanStaleLocks() {
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
  try {
    const staleEnrollments = await DripEnrollment.find({
      isProcessing: true,
      processingStartedAt: { $lt: twoMinutesAgo },
    }).limit(50);

    for (const enrollment of staleEnrollments) {
      // Check if a message was already sent for this processing session
      const alreadySentLog = await DripDeliveryLog.findOne({
        enrollmentId: enrollment._id,
        sentAt: { $gte: enrollment.processingStartedAt },
      });

      if (alreadySentLog) {
        // Message was already delivered before worker crash — advance state without resending!
        const steps = await DripStep.find({ campaignId: enrollment.campaignId }).sort('order');
        const nextStep = steps[enrollment.currentStepIndex + 1];
        if (nextStep) {
          enrollment.currentStepIndex += 1;
          enrollment.nextDueAt = calculateStepDueAt(enrollment.enrolledAt, nextStep);
        } else {
          enrollment.status = 'completed';
        }
        enrollment.retryCount = 0;
      }

      // Clear the processing lock
      enrollment.isProcessing = false;
      enrollment.processingStartedAt = null;
      await enrollment.save();
    }
  } catch (err) {
    error('[Drip Scheduler] Stale lock cleaner error:', { message: err.message });
  }
}

/**
 * Auto-promote scheduled campaigns whose startDate has arrived or has due contacts
 */
async function promoteScheduledCampaigns() {
  try {
    // 1. Promote scheduled campaigns whose startDate is now or past
    await DripCampaign.updateMany(
      { status: 'scheduled', startDate: { $lte: new Date() } },
      { $set: { status: 'active' } }
    );

    // 2. Also promote any scheduled campaign that has active enrollments with nextDueAt <= now
    const dueCampaignIds = await DripEnrollment.find({
      status: 'active',
      nextDueAt: { $lte: new Date() },
    }).distinct('campaignId');

    if (dueCampaignIds.length > 0) {
      await DripCampaign.updateMany(
        { _id: { $in: dueCampaignIds }, status: 'scheduled' },
        { $set: { status: 'active' } }
      );
    }
  } catch (err) {
    error('[Drip Scheduler] Failed to promote scheduled campaigns:', { message: err.message });
  }
}

/**
 * Resolve template variables dynamically from contact document and step mapping
 */
function resolveTemplateVariables(contact, variableMapping = [], template) {
  const params = [];
  const mappings = Array.isArray(variableMapping) ? variableMapping : [];

  // 1. If template has an IMAGE header, add header_image param
  if ((template?.headerType === 'IMAGE' || template?.mediaType === 'image')) {
    const sampleHeader = template.sampleParams?.find(p => p.key === 'header_image')?.value;
    let imgUrl = sampleHeader || template.mediaUrl;

    if (imgUrl && typeof imgUrl === 'string' && imgUrl.includes('r2.cloudflarestorage.com')) {
      const publicBase = (process.env.R2_PUBLIC_URL || 'https://pub-922d0b8e92144ec8adc99d837e581709.r2.dev').replace(/\/$/, '');
      const pathParts = imgUrl.split('/templates/');
      if (pathParts.length > 1) {
        imgUrl = `${publicBase}/templates/${pathParts[1]}`;
      }
    }

    // Meta Cloud API rejects scontent.whatsapp.net / fbcdn.net URLs with #131053 Media upload error
    if (
      !imgUrl ||
      typeof imgUrl !== 'string' ||
      !imgUrl.startsWith('http') ||
      imgUrl.startsWith('blob:') ||
      imgUrl.includes('r2.cloudflarestorage.com') ||
      imgUrl.includes('scontent.whatsapp.net') ||
      imgUrl.includes('fbcdn.net') ||
      imgUrl.includes('facebook.com')
    ) {
      imgUrl = 'https://pub-922d0b8e92144ec8adc99d837e581709.r2.dev/templates/1788359049295-0a037ab5553e45de7a3da761.jpg';
    }

    params.push({
      type: 'image',
      parameter_name: 'header_image',
      key: 'header_image',
      value: imgUrl,
      text: imgUrl,
    });
  }

  // 2. Count actual body variables in template text (e.g. {{1}}, {{2}})
  const textToScan = (template?.bodyPreview || template?.body || template?.content || '');
  const matches = textToScan.match(/\{\{(\d+)\}\}/g) || [];
  const bodyVarNumbers = [...new Set(matches.map(m => m.replace(/[{}]/g, '')))].sort((a, b) => Number(a) - Number(b));
  const expectedBodyVarCount = bodyVarNumbers.length;

  if (expectedBodyVarCount > 0) {
    // Filter sampleParams to only numeric/body keys (exclude 'header_image')
    const sampleBodyParams = (template?.sampleParams || []).filter(p => p.key !== 'header_image' && !isNaN(Number(p.key)));

    for (let i = 0; i < expectedBodyVarCount; i++) {
      const varNum = bodyVarNumbers[i];
      const mapItem = mappings.find(m => String(m.position) === String(varNum) || String(m.position) === String(i + 1));
      const sampleItem = sampleBodyParams.find(p => String(p.key) === String(varNum) || String(p.key) === String(i + 1));

      let val = '';
      if (mapItem) {
        const source = mapItem.source || 'contact.name';
        const fallback = mapItem.fallback || '';
        if (source === 'contact.name') val = contact?.name || fallback;
        else if (source === 'contact.phone') val = contact?.phone || fallback;
        else if (source === 'contact.email') val = contact?.email || fallback;
        else if (source.startsWith('tag:') && contact?.tags?.length) val = contact.tags[0] || fallback;
        else val = fallback || contact?.name || 'Customer';
      } else if (sampleItem && sampleItem.value) {
        // If 1st variable, prefer contact name if sample is generic, else use sample value
        if (i === 0 && contact?.name && !sampleItem.value.startsWith('http')) {
          val = contact.name;
        } else {
          val = sampleItem.value;
        }
      } else {
        val = i === 0 ? (contact?.name || 'Customer') : `Value ${i + 1}`;
      }

      params.push({
        type: 'text',
        text: String(val).trim(),
        parameter_name: String(varNum),
        key: String(varNum),
        value: String(val).trim(),
      });
    }
  }

  return params;
}

/**
 * Core Drip Dispatch Cycle
 */
async function runDripSchedulerCycle() {
  if (isRunning) return;
  isRunning = true;

  try {
    // 1. Recover stale locks
    await cleanStaleLocks();

    // 2. Auto-promote scheduled campaigns to active
    await promoteScheduledCampaigns();

    // 3. Find active campaigns only
    const activeCampaigns = await DripCampaign.find({ status: 'active' }).select('_id preferredSendTime name');
    const activeCampaignIds = activeCampaigns.map((c) => c._id);

    if (!activeCampaignIds.length) {
      isRunning = false;
      return;
    }

    // 4. Find due active enrollments belonging to active campaigns
    const now = new Date();
    const dueEnrollments = await DripEnrollment.find({
      campaignId: { $in: activeCampaignIds },
      nextDueAt: { $lte: now },
      status: 'active',
      isProcessing: { $ne: true },
    }).limit(100);

    if (!dueEnrollments.length) {
      isRunning = false;
      return;
    }

    // 5. Atomically claim batch to prevent race conditions
    const claimedEnrollments = [];
    for (const item of dueEnrollments) {
      const claimed = await DripEnrollment.findOneAndUpdate(
        { _id: item._id, status: 'active', isProcessing: { $ne: true } },
        { $set: { isProcessing: true, processingStartedAt: new Date() } },
        { new: true }
      );
      if (claimed) claimedEnrollments.push(claimed);
    }

    if (!claimedEnrollments.length) {
      isRunning = false;
      return;
    }

    // 6. Batch In-Memory Maps (Campaign, User, Steps, Contacts)
    const uniqueCampaignIds = [...new Set(claimedEnrollments.map((e) => String(e.campaignId)))];
    const uniqueUserIds = [...new Set(claimedEnrollments.map((e) => String(e.userId)))];
    const uniqueContactIds = [...new Set(claimedEnrollments.map((e) => String(e.contactId)))];

    const [campaigns, users, dripSteps, contacts] = await Promise.all([
      DripCampaign.find({ _id: { $in: uniqueCampaignIds } }).select('status name preferredSendTime'),
      User.find({ _id: { $in: uniqueUserIds } }).select('businessHours name email whatsappPhoneNumberId'),
      DripStep.find({ campaignId: { $in: uniqueCampaignIds } }).sort('order'),
      Contact.find({ _id: { $in: uniqueContactIds } }).select('name phone email tags optedOut'),
    ]);

    const campaignMap = new Map(campaigns.map((c) => [String(c._id), c]));
    const userMap = new Map(users.map((u) => [String(u._id), u]));
    const contactMap = new Map(contacts.map((c) => [String(c._id), c]));

    const stepsByCampaign = new Map();
    for (const step of dripSteps) {
      const key = String(step.campaignId);
      if (!stepsByCampaign.has(key)) stepsByCampaign.set(key, []);
      stepsByCampaign.get(key).push(step);
    }

    // 7. Process each claimed enrollment
    for (const enrollment of claimedEnrollments) {
      try {
        // Guard 1: Campaign must be active
        const parentCampaign = campaignMap.get(String(enrollment.campaignId));
        if (!parentCampaign || parentCampaign.status !== 'active') {
          enrollment.isProcessing = false;
          enrollment.processingStartedAt = null;
          await enrollment.save();
          continue;
        }

        // Guard 2: Must be within client's business hours
        const owner = userMap.get(String(enrollment.userId));
        if (!isWithinBusinessHours(owner)) {
          // Outside business hours: release lock cleanly without advancing dates or retries
          enrollment.isProcessing = false;
          enrollment.processingStartedAt = null;
          await enrollment.save();
          continue;
        }

        // Guard 3: Fetch contact & verify opt-out
        const contact = contactMap.get(String(enrollment.contactId));
        if (!contact || contact.optedOut) {
          enrollment.status = contact?.optedOut ? 'opted_out' : 'failed';
          enrollment.isProcessing = false;
          enrollment.processingStartedAt = null;
          await enrollment.save();
          continue;
        }

        // Guard 4: Fetch steps and current step
        const steps = stepsByCampaign.get(String(enrollment.campaignId)) || [];
        const currentStep = steps[enrollment.currentStepIndex];
        if (!currentStep) {
          enrollment.status = 'completed';
          enrollment.isProcessing = false;
          enrollment.processingStartedAt = null;
          await enrollment.save();
          continue;
        }

        // Guard 5: Live Template Approval Safety Check
        let template = await Template.findById(currentStep.templateId);
        if (!template) {
          // If template doc missing, check by whatsappTemplateName or fallback
          template = await Template.findOne({
            $or: [{ userId: enrollment.userId }, { assignedTo: enrollment.userId }],
            metaStatus: 'APPROVED',
          });
        }

        if (!template || template.metaStatus !== 'APPROVED') {
          error('[Drip Scheduler] Template not approved at send time:', {
            templateId: currentStep.templateId,
            metaStatus: template?.metaStatus || 'MISSING',
            campaignId: enrollment.campaignId,
            stepOrder: currentStep.order,
          });

          // Log failure record so user can clearly see why this step is waiting in UI
          await DripDeliveryLog.create({
            userId: enrollment.userId,
            campaignId: enrollment.campaignId,
            enrollmentId: enrollment._id,
            stepId: currentStep._id,
            contactId: enrollment.contactId,
            phone: enrollment.phone,
            deliveryStatus: 'failed',
            errorReason: `Template "${template?.name || 'Step ' + currentStep.order}" is not approved by Meta (Status: ${template?.metaStatus || 'MISSING'}). Approve template to resume sequence.`,
          }).catch(() => {});

          // Release lock and push nextDueAt 30 minutes into future so it doesn't block other enrollments
          enrollment.isProcessing = false;
          enrollment.processingStartedAt = null;
          enrollment.nextDueAt = new Date(Date.now() + 30 * 60 * 1000);
          await enrollment.save();
          continue;
        }

        // 8. Resolve dynamic variables & send message
        const params = resolveTemplateVariables(contact, currentStep.variableMapping, template);
        const toPhone = enrollment.phone;

        let apiRes = null;
        try {
          apiRes = await whatsapp.sendTemplateMessage(
            enrollment.userId,
            toPhone,
            template.whatsappTemplateName,
            template.languageCode || 'en',
            params
          );
        } catch (sendErr) {
          const isRateLimit =
            sendErr.response?.status === 429 ||
            sendErr.response?.data?.error?.code === 130429 ||
            sendErr.message?.includes('rate');

          if (isRateLimit) {
            if (enrollment.retryCount >= 5) {
              enrollment.status = 'failed';
              enrollment.isProcessing = false;
              enrollment.processingStartedAt = null;
            } else {
              const delay = Math.min(Math.pow(2, enrollment.retryCount) * 60 * 1000, 30 * 60 * 1000);
              enrollment.nextDueAt = new Date(Date.now() + delay);
              enrollment.retryCount += 1;
              enrollment.isProcessing = false;
              enrollment.processingStartedAt = null;
            }
            await enrollment.save();
            continue;
          }

          // Non-rate limit send error
          const errMsg = sendErr.response?.data?.error?.message || sendErr.message || 'Meta send failed';
          await DripDeliveryLog.create({
            userId: enrollment.userId,
            campaignId: enrollment.campaignId,
            enrollmentId: enrollment._id,
            stepId: currentStep._id,
            contactId: enrollment.contactId,
            phone: toPhone,
            deliveryStatus: 'failed',
            errorReason: errMsg,
          });

          enrollment.retryCount += 1;
          if (enrollment.retryCount >= 3) {
            enrollment.status = 'failed';
          } else {
            // Push 15 minutes forward for retry
            enrollment.nextDueAt = new Date(Date.now() + 15 * 60 * 1000);
          }
          enrollment.isProcessing = false;
          enrollment.processingStartedAt = null;
          await enrollment.save();
          continue;
        }

        // 9. Successful dispatch -> Log & State transition
        const metaMessageId = apiRes?.messages?.[0]?.id || '';
        await DripDeliveryLog.create({
          userId: enrollment.userId,
          campaignId: enrollment.campaignId,
          enrollmentId: enrollment._id,
          stepId: currentStep._id,
          contactId: enrollment.contactId,
          phone: toPhone,
          metaMessageId,
          deliveryStatus: 'sent',
          sentAt: new Date(),
        });

        // Create or update conversation and message in Inbox CRM
        try {
          let renderedBody = template?.bodyPreview || `[Template: ${template?.name || 'Drip Step'}]`;
          const varParams = params.filter(p => p.parameter_name !== 'header_image');
          varParams.forEach((p, idx) => {
            renderedBody = renderedBody.replace(new RegExp(`\\{\\{${idx + 1}\\}\\}`, 'g'), p.value || p.text || '');
          });

          let conv = await Conversation.findOne({ userId: enrollment.userId, customerPhone: toPhone });
          if (!conv) {
            conv = await Conversation.create({
              userId: enrollment.userId,
              customerPhone: toPhone,
              customerName: contact?.name || 'Customer',
              lastMessage: renderedBody,
              lastMessageAt: new Date(),
              unreadCount: 0,
            });
          } else {
            conv.lastMessage = renderedBody;
            conv.lastMessageAt = new Date();
            await conv.save();
          }

          const outboundMsg = await Message.create({
            userId: enrollment.userId,
            conversationId: conv._id,
            direction: 'outbound',
            from: 'campaign',
            to: toPhone,
            body: renderedBody,
            type: (template?.headerType === 'IMAGE' || template?.mediaType === 'image') ? 'image' : 'text',
            mediaUrl: template?.mediaUrl || '',
            status: 'sent',
            whatsappMessageId: metaMessageId,
          });

          emitToUser(String(enrollment.userId), 'inbox:newMessage', {
            conversationId: String(conv._id),
            message: outboundMsg,
          });
          emitToUser(String(enrollment.userId), 'inbox:update', { conversationId: String(conv._id) });
        } catch (crmErr) {
          console.error('[Drip Scheduler] CRM inbox logging error:', crmErr.message);
        }

        enrollment.lastSentAt = new Date();
        enrollment.lastSentStepId = currentStep._id;
        enrollment.retryCount = 0; // RESET retry counter on successful send!
        enrollment.isProcessing = false;
        enrollment.processingStartedAt = null;

        const nextStep = steps[enrollment.currentStepIndex + 1];
        if (nextStep) {
          enrollment.currentStepIndex += 1;
          const nextBase = enrollment.lastSentAt || new Date();
          const userTz = owner?.businessHours?.timezone || 'Asia/Kolkata';
          enrollment.nextDueAt = calculateStepDueAt(
            nextBase,
            nextStep,
            parentCampaign?.preferredSendTime || '10:00',
            userTz,
            false
          );
        } else {
          enrollment.status = 'completed';
          await enrollment.save();

          // Check if ALL enrollments for this campaign are now completed
          const remainingUnfinished = await DripEnrollment.countDocuments({
            campaignId: enrollment.campaignId,
            status: { $in: ['active', 'paused', 'scheduled'] },
          });

          if (remainingUnfinished === 0) {
            await DripCampaign.findByIdAndUpdate(enrollment.campaignId, {
              status: 'completed',
              completedAt: new Date(),
              stoppedAt: new Date(),
            });
            info(`[Drip Scheduler] Campaign ${enrollment.campaignId} auto-completed (all steps finished for all contacts)`);
          }
        }

        await enrollment.save();

        // 35ms throttle between sends
        await sleep(35);
      } catch (itemErr) {
        error('[Drip Scheduler] Enrollment processing error:', {
          enrollmentId: enrollment._id,
          reason: itemErr.message,
        });
        enrollment.isProcessing = false;
        enrollment.processingStartedAt = null;
        await enrollment.save().catch(() => {});
      }
    }
  } catch (cycleErr) {
    error('[Drip Scheduler] Cycle error:', { reason: cycleErr.message });
  } finally {
    isRunning = false;
  }
}

/**
 * Synchronously run drip dispatch for a specific campaign
 * @param {string} campaignId
 * @param {string} userId
 * @param {boolean} forceAllActive - If true, dispatches any active contacts regardless of nextDueAt
 */
async function dispatchDueStepsForCampaign(campaignId, userId, forceAllActive = false) {
  const campaign = await DripCampaign.findOne({ _id: campaignId, userId });
  if (!campaign) {
    throw new Error('Campaign not found');
  }

  if (campaign.status === 'scheduled') {
    campaign.status = 'active';
    await campaign.save();
  }

  if (campaign.status !== 'active') {
    throw new Error(`Campaign is currently ${campaign.status}. Activate or resume campaign first.`);
  }

  if (forceAllActive) {
    // Set nextDueAt to now for all active non-processing enrollments
    await DripEnrollment.updateMany(
      { campaignId, status: 'active', isProcessing: { $ne: true } },
      { $set: { nextDueAt: new Date(), retryCount: 0 } }
    );
  }

  await runDripSchedulerCycle();

  const [activeCount, completedCount, failedCount, remainingDue] = await Promise.all([
    DripEnrollment.countDocuments({ campaignId, status: 'active' }),
    DripEnrollment.countDocuments({ campaignId, status: 'completed' }),
    DripEnrollment.countDocuments({ campaignId, status: 'failed' }),
    DripEnrollment.countDocuments({ campaignId, status: 'active', nextDueAt: { $lte: new Date() } }),
  ]);

  return {
    campaignStatus: campaign.status,
    activeCount,
    completedCount,
    failedCount,
    remainingDue,
  };
}

let schedulerStarted = false;function initDripScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Run every 15 seconds for real-time sub-minute dispatch responsiveness
  setInterval(async () => {
    await runDripSchedulerCycle().catch((err) => {
      error('[Drip Scheduler] Interval cycle error:', { message: err.message });
    });
  }, 15000);

  // Run every minute via node-cron as redundant safety backup
  cron.schedule('* * * * *', async () => {
    await runDripSchedulerCycle().catch((err) => {
      error('[Drip Scheduler] Cron cycle error:', { message: err.message });
    });
  });

  // Kick off initial cycle 2 seconds after server boot
  setTimeout(() => {
    runDripSchedulerCycle().catch(() => {});
  }, 2000);

  info('WhatsApp Drip Campaign Scheduler initialized (high-frequency 15s interval + 1m cron)');
}

function getTzOffsetMinutes(date, tz = 'Asia/Kolkata') {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const p = {};
    parts.forEach(({ type, value }) => { p[type] = value; });

    const tzHour = parseInt(p.hour, 10) === 24 ? 0 : parseInt(p.hour, 10);
    const tzAsUtc = Date.UTC(
      parseInt(p.year, 10),
      parseInt(p.month, 10) - 1,
      parseInt(p.day, 10),
      tzHour,
      parseInt(p.minute, 10),
      parseInt(p.second, 10)
    );
    return (tzAsUtc - date.getTime()) / 60000;
  } catch (err) {
    return 330; // Default IST offset (+05:30)
  }
}

function createDateInTimezone(year, month, day, hours, minutes, timezone = 'Asia/Kolkata') {
  const provisionalUtc = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));
  const offsetMinutes = getTzOffsetMinutes(provisionalUtc, timezone);
  return new Date(provisionalUtc.getTime() - offsetMinutes * 60000);
}

function calculateStepDueAt(baselineDate, step, defaultTime = '10:00', tz = 'Asia/Kolkata', isFirstStep = false) {
  const base = new Date(baselineDate || Date.now());
  const unit = step.offsetUnit || 'days';
  const val = Number(step.offsetValue !== undefined ? step.offsetValue : (step.dayOffset ?? 1));

  // If first step and user selected 0 delay or immediate, send immediately (now)
  if (isFirstStep && (val <= 0 || !step.sendTime)) {
    if (unit === 'minutes' || unit === 'hours') return new Date();
    if (unit === 'days' && val <= 1 && (!step.sendTime || step.sendTime === '')) {
      return new Date();
    }
  }

  if (unit === 'minutes') {
    if (isFirstStep && val <= 0) return new Date();
    const mins = isFirstStep ? Math.max(0, val) : Math.max(1, val);
    const target = new Date(base.getTime() + mins * 60 * 1000);
    if (isFirstStep && target.getTime() <= Date.now() + 60000) return new Date();
    return target;
  }

  if (unit === 'hours') {
    if (isFirstStep && val <= 0) return new Date();
    const hrs = isFirstStep ? Math.max(0, val) : Math.max(1, val);
    const target = new Date(base.getTime() + hrs * 3600 * 1000);
    if (isFirstStep && target.getTime() <= Date.now() + 60000) return new Date();
    return target;
  }

  if (unit === 'months') {
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz || 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const ymd = formatter.format(base);
      const [y, m, d] = ymd.split('-').map(Number);
      const monthsToAdd = isFirstStep ? (val <= 1 ? 0 : val - 1) : Math.max(1, val);
      const monthBase = new Date(Date.UTC(y, m - 1 + monthsToAdd, d, 12, 0, 0));
      const targetY = monthBase.getUTCFullYear();
      const targetM = monthBase.getUTCMonth() + 1;
      const targetD = monthBase.getUTCDate();

      const timeStr = step.sendTime || defaultTime || '10:00';
      let hours = 10;
      let minutes = 0;
      if (timeStr && timeStr.includes(':')) {
        const [h, min] = timeStr.split(':').map(Number);
        if (!isNaN(h) && !isNaN(min)) {
          hours = h;
          minutes = min;
        }
      }
      return createDateInTimezone(targetY, targetM, targetD, hours, minutes, tz);
    } catch (e) {
      return new Date(base.getTime() + val * 30 * 24 * 3600 * 1000);
    }
  }

  // unit === 'days'
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const ymd = formatter.format(base);
    const [y, m, d] = ymd.split('-').map(Number);

    const daysToAdd = isFirstStep ? (val <= 1 ? 0 : val - 1) : Math.max(1, val);
    const dayBase = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    dayBase.setUTCDate(dayBase.getUTCDate() + daysToAdd);

    const targetY = dayBase.getUTCFullYear();
    const targetM = dayBase.getUTCMonth() + 1;
    const targetD = dayBase.getUTCDate();

    const timeStr = step.sendTime || defaultTime || '10:00';
    let hours = 10;
    let minutes = 0;
    if (timeStr && timeStr.includes(':')) {
      const [h, min] = timeStr.split(':').map(Number);
      if (!isNaN(h) && !isNaN(min)) {
        hours = h;
        minutes = min;
      }
    }

    const targetDate = createDateInTimezone(targetY, targetM, targetD, hours, minutes, tz);

    // If Step 1 on start date and the scheduled hour/minute has already arrived or passed, send immediately now!
    if (isFirstStep && daysToAdd === 0 && (!step.sendTime || targetDate.getTime() <= Date.now() + 60000)) {
      return new Date();
    }
    return targetDate;
  } catch (err) {
    const d = new Date(base);
    const daysToAdd = isFirstStep ? (val <= 1 ? 0 : val - 1) : Math.max(1, val);
    d.setDate(d.getDate() + daysToAdd);
    return d;
  }
}

module.exports = {
  initDripScheduler,
  runDripSchedulerCycle,
  dispatchDueStepsForCampaign,
  resolveTemplateVariables,
  calculateStepDueAt,
};
