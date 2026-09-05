const DripCampaign = require('../models/DripCampaign');
const DripStep = require('../models/DripStep');
const DripEnrollment = require('../models/DripEnrollment');
const DripDeliveryLog = require('../models/DripDeliveryLog');
const Template = require('../models/Template');
const Contact = require('../models/Contact');
const ContactGroup = require('../models/ContactGroup');
const User = require('../models/User');
const { success, fail } = require('../utils/apiResponse');
const { normalizePhone } = require('../utils/csvParser');
const { generateDripStrategy, processGeneratedStepsWithTemplates } = require('../services/dripAi.service');
const whatsapp = require('../services/whatsapp.service');
const {
  calculateStepDueAt,
  resolveTemplateVariables,
  runDripSchedulerCycle,
  dispatchDueStepsForCampaign,
} = require('../services/dripScheduler.service');

// ─── List All Drip Campaigns for User ──────────────────────────────────────────
exports.listDripCampaigns = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;

    // Trigger eager background scheduler run to immediately process any due messages
    runDripSchedulerCycle().catch(() => {});

    const campaigns = await DripCampaign.find({ userId })
      .populate('audienceGroupId', 'name contactCount')
      .sort({ createdAt: -1 });

    const campaignIds = campaigns.map((c) => c._id);

    // 1. Aggregate enrollment stats
    const enrollmentStats = await DripEnrollment.aggregate([
      { $match: { campaignId: { $in: campaignIds } } },
      {
        $group: {
          _id: '$campaignId',
          totalEnrolled: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          paused: { $sum: { $cond: [{ $eq: ['$status', 'paused'] }, 1, 0] } },
          converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
          optedOut: { $sum: { $cond: [{ $eq: ['$status', 'opted_out'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          stopped: { $sum: { $cond: [{ $eq: ['$status', 'stopped'] }, 1, 0] } },
        },
      },
    ]);

    // 2. Aggregate delivery logs for actual messages sent (₹1 per message)
    const deliveryStats = await DripDeliveryLog.aggregate([
      { $match: { campaignId: { $in: campaignIds }, deliveryStatus: { $in: ['sent', 'delivered', 'read'] } } },
      {
        $group: {
          _id: '$campaignId',
          totalSent: { $sum: 1 },
          delivered: { $sum: { $cond: [{ $in: ['$deliveryStatus', ['delivered', 'read']] }, 1, 0] } },
          read: { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'read'] }, 1, 0] } },
        },
      },
    ]);

    const statsMap = new Map(enrollmentStats.map((s) => [String(s._id), s]));
    const deliveryMap = new Map(deliveryStats.map((d) => [String(d._id), d]));

    let totalDispatchedOverall = 0;

    const enriched = campaigns.map((c) => {
      const s = statsMap.get(String(c._id)) || {
        totalEnrolled: 0,
        active: 0,
        paused: 0,
        converted: 0,
        optedOut: 0,
        completed: 0,
        stopped: 0,
      };
      const del = deliveryMap.get(String(c._id)) || { totalSent: 0, delivered: 0, read: 0 };
      const totalSent = del.totalSent || 0;
      totalDispatchedOverall += totalSent;

      return {
        ...c.toObject(),
        stats: {
          ...s,
          totalSent,
          totalSpent: totalSent * 1.0, // ₹1.00 per message sent
          deliveredCount: del.delivered || 0,
          readCount: del.read || 0,
        },
      };
    });

    const totalSpentOverall = totalDispatchedOverall * 1.0; // ₹1.00 per message sent

    return success(
      res,
      {
        campaigns: enriched,
        totalDispatchedOverall,
        totalSpentOverall,
      },
      'Drip campaigns fetched successfully'
    );
  } catch (err) {
    return fail(res, err.message || 'Failed to list drip campaigns', 500);
  }
};

// ─── Get Single Drip Campaign with Steps & Live Progress Metrics ──────────────
exports.getDripCampaign = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;

    // Trigger eager background scheduler run to immediately process any due messages
    runDripSchedulerCycle().catch(() => {});

    const campaign = await DripCampaign.findOne({ _id: req.params.id, userId })
      .populate('audienceGroupId', 'name contactCount');

    if (!campaign) {
      return fail(res, 'Drip campaign not found', 404);
    }

    const steps = await DripStep.find({ campaignId: campaign._id })
      .populate('templateId', 'name whatsappTemplateName category metaStatus bodyPreview headerType sampleParams')
      .sort({ order: 1 });

    // 1. Fetch enrollments & delivery logs for live progress tracking
    const enrollments = await DripEnrollment.find({ campaignId: campaign._id }).lean();
    const logs = await DripDeliveryLog.find({ campaignId: campaign._id }).lean();

    const totalEnrolled = enrollments.length;
    const completedEnrollments = enrollments.filter((e) => e.status === 'completed').length;
    const activeEnrollments = enrollments.filter((e) => e.status === 'active').length;
    const pausedEnrollments = enrollments.filter((e) => e.status === 'paused').length;

    // Auto-complete campaign if all contacts finished
    if (totalEnrolled > 0 && completedEnrollments === totalEnrolled && campaign.status !== 'completed') {
      campaign.status = 'completed';
      campaign.completedAt = campaign.completedAt || new Date();
      campaign.stoppedAt = campaign.stoppedAt || new Date();
      await campaign.save();
    }

    // 2. Compute per-step progress
    const enrichedSteps = steps.map((s, idx) => {
      const stepObj = s.toObject();
      const stepLogs = logs.filter((l) => String(l.stepId) === String(s._id));
      
      const sentCount = stepLogs.filter((l) => ['sent', 'delivered', 'read'].includes(l.deliveryStatus)).length;
      const deliveredCount = stepLogs.filter((l) => ['delivered', 'read'].includes(l.deliveryStatus)).length;
      const readCount = stepLogs.filter((l) => l.deliveryStatus === 'read').length;
      const failedCount = stepLogs.filter((l) => l.deliveryStatus === 'failed').length;
      const totalAttempted = sentCount + failedCount;

      const lastLog = stepLogs.sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0))[0];

      // A step is completed if all enrolled contacts have moved past this step (currentStepIndex > idx)
      // OR if every contact has an attempted/sent delivery log for this step
      const allPassed = totalEnrolled > 0 && enrollments.every((e) => e.currentStepIndex > idx || e.status === 'completed');
      const isCompleted = allPassed || (totalEnrolled > 0 && totalAttempted >= totalEnrolled);
      const isCurrent = !isCompleted && enrollments.some((e) => e.currentStepIndex === idx && ['active', 'paused'].includes(e.status));
      const isPending = !isCompleted && !isCurrent;

      return {
        ...stepObj,
        progress: {
          sentCount,
          deliveredCount,
          readCount,
          failedCount,
          totalAttempted,
          lastSentAt: lastLog?.sentAt || null,
          isCompleted,
          isCurrent,
          isPending,
          completionPercent: totalEnrolled > 0 ? Math.min(100, Math.round((Math.max(sentCount, totalAttempted) / totalEnrolled) * 100)) : 0,
        },
      };
    });

    // 3. Campaign-level step progress summary
    const completedStepsCount = enrichedSteps.filter((s) => s.progress?.isCompleted).length;
    const remainingStepsCount = Math.max(0, enrichedSteps.length - completedStepsCount);
    const overallProgressPercent = enrichedSteps.length > 0
      ? Math.round((completedStepsCount / enrichedSteps.length) * 100)
      : 0;

    const failedEnrollments = enrollments.filter((e) => e.status === 'failed').length;
    const unapprovedSteps = enrichedSteps.filter((s) => {
      const t = s.templateId;
      return !t || t.metaStatus !== 'APPROVED';
    });

    const progressSummary = {
      totalSteps: enrichedSteps.length,
      completedStepsCount,
      remainingStepsCount,
      overallProgressPercent,
      totalEnrolled,
      completedEnrollments,
      activeEnrollments,
      pausedEnrollments,
      failedEnrollments,
      unapprovedStepsCount: unapprovedSteps.length,
      unapprovedStepNumbers: unapprovedSteps.map((s) => s.order),
      totalSentMsgs: logs.filter((l) => ['sent', 'delivered', 'read'].includes(l.deliveryStatus)).length,
      totalActualCost: logs.filter((l) => ['sent', 'delivered', 'read'].includes(l.deliveryStatus)).length * 1.0, // ₹1.00 per message sent
      isFullyCompleted: campaign.status === 'completed' || (totalEnrolled > 0 && completedStepsCount === enrichedSteps.length),
    };

    const campaignObj = campaign.toObject();
    campaignObj.totalSentMsgs = progressSummary.totalSentMsgs;
    campaignObj.totalActualCost = progressSummary.totalActualCost;

    return success(res, { campaign: campaignObj, steps: enrichedSteps, progressSummary }, 'Campaign details retrieved');
  } catch (err) {
    return fail(res, err.message || 'Failed to get campaign details', 500);
  }
};

// ─── Create Manual Drip Campaign ──────────────────────────────────────────────
exports.createManualCampaign = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;
    const { name, goalDescription, durationDays = 30, startDate, audienceGroupId, steps = [] } = req.body;

    if (!name || !audienceGroupId || !steps.length) {
      return fail(res, 'Campaign name, audience group, and at least one step are required', 400);
    }

    // Verify audience group belongs to user
    const group = await ContactGroup.findOne({ _id: audienceGroupId, userId });
    if (!group) {
      return fail(res, 'Audience group not found or unauthorized', 404);
    }

    const countContacts = await Contact.countDocuments({
      userId,
      group: { $in: [audienceGroupId] },
      optedOut: false,
    });

    // Verify all templates are approved
    const templateIds = steps.map((s) => s.templateId);
    const templates = await Template.find({
      _id: { $in: templateIds },
      $or: [{ userId }, { assignedTo: userId }],
    });

    if (templates.length !== templateIds.length) {
      return fail(res, 'One or more selected templates were not found', 400);
    }

    const unapproved = templates.filter((t) => t.metaStatus !== 'APPROVED');
    if (unapproved.length > 0) {
      return fail(res, 'Manual mode requires all selected templates to be approved by Meta', 400);
    }

    const templateMap = new Map(templates.map((t) => [String(t._id), t]));
    let marketingCount = 0;
    let utilityCount = 0;

    steps.forEach((s) => {
      const t = templateMap.get(String(s.templateId));
      if (t?.category === 'UTILITY') utilityCount++;
      else marketingCount++;
    });

    const parsedStartDate = startDate ? new Date(startDate) : new Date();

    const campaign = await DripCampaign.create({
      userId,
      name: name.trim(),
      goalDescription: goalDescription || '',
      mode: 'manual',
      durationDays: parseInt(durationDays, 10) || 30,
      startDate: parsedStartDate,
      audienceGroupId,
      status: 'draft',
      totalAudience: countContacts,
      totalSteps: steps.length,
      categoryBreakdown: {
        marketingCount: marketingCount * countContacts,
        utilityCount: utilityCount * countContacts,
      },
      estimatedCost: (marketingCount * countContacts * 0.85) + (utilityCount * countContacts * 0.15),
    });

    const stepDocs = steps.map((s, idx) => ({
      campaignId: campaign._id,
      dayOffset: parseInt(s.dayOffset, 10) || (idx * 5) + 1,
      offsetValue: s.offsetValue !== undefined ? Number(s.offsetValue) : (parseInt(s.dayOffset, 10) || (idx * 5) + 1),
      offsetUnit: s.offsetUnit || 'days',
      sendTime: s.sendTime || '',
      order: idx + 1,
      templateId: s.templateId,
      notes: s.notes || '',
      mediaType: s.mediaType || 'text',
      variableMapping: Array.isArray(s.variableMapping) ? s.variableMapping : [],
    }));

    await DripStep.insertMany(stepDocs);

    return success(res, { campaign, steps: stepDocs }, 'Manual Drip Campaign created successfully', 201);
  } catch (err) {
    return fail(res, err.message || 'Failed to create manual drip campaign', 500);
  }
};

// ─── Generate AI Drip Campaign ────────────────────────────────────────────────
exports.generateAiCampaign = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;
    const { name, goal, durationDays = 30, startDate, audienceGroupId, language = 'en' } = req.body;

    if (!goal || !audienceGroupId) {
      return fail(res, 'Campaign goal and audience group are required', 400);
    }

    const group = await ContactGroup.findOne({ _id: audienceGroupId, userId });
    if (!group) {
      return fail(res, 'Audience group not found', 404);
    }

    const countContacts = await Contact.countDocuments({
      userId,
      group: { $in: [audienceGroupId] },
      optedOut: false,
    });

    // 1. Generate structured strategy via AI
    const rawSteps = await generateDripStrategy({
      goal,
      durationDays: parseInt(durationDays, 10) || 30,
      audienceSize: countContacts || 100,
      userId,
      language,
    });

    // 2. Map steps to approved templates or create draft templates
    const { steps: processedSteps, allApproved, suggestedStatus } = await processGeneratedStepsWithTemplates(
      userId,
      rawSteps
    );

    const parsedStartDate = startDate ? new Date(startDate) : new Date();

    const campaign = await DripCampaign.create({
      userId,
      name: name?.trim() || `AI: ${goal.slice(0, 30)}...`,
      goalDescription: goal,
      mode: 'ai',
      durationDays: parseInt(durationDays, 10) || 30,
      startDate: parsedStartDate,
      audienceGroupId,
      status: suggestedStatus,
      totalAudience: countContacts,
      totalSteps: processedSteps.length,
      categoryBreakdown: {
        marketingCount: processedSteps.filter((s) => s.suggestedCategory === 'MARKETING').length * countContacts,
        utilityCount: processedSteps.filter((s) => s.suggestedCategory === 'UTILITY').length * countContacts,
      },
    });

    const stepDocs = processedSteps.map((s, idx) => ({
      campaignId: campaign._id,
      dayOffset: s.dayOffset,
      offsetValue: s.offsetValue !== undefined ? Number(s.offsetValue) : (s.dayOffset || (idx * 5) + 1),
      offsetUnit: s.offsetUnit || 'days',
      sendTime: s.sendTime || '',
      order: idx + 1,
      templateId: s.templateId,
      notes: s.notes || '',
      mediaType: s.mediaType || 'text',
      variableMapping: s.variableMapping || [],
    }));

    await DripStep.insertMany(stepDocs);

    return success(
      res,
      { campaign, steps: processedSteps, allApproved },
      'AI Drip Campaign generated successfully',
      201
    );
  } catch (err) {
    return fail(res, err.message || 'Failed to generate AI drip campaign', 500);
  }
};

// ─── Update Single Step in Drip Campaign ──────────────────────────────────────
exports.updateStep = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;
    const { id, stepId } = req.params;
    const { dayOffset, templateId, notes, mediaType, variableMapping } = req.body;

    const campaign = await DripCampaign.findOne({ _id: id, userId });
    if (!campaign) {
      return fail(res, 'Campaign not found or unauthorized', 404);
    }

    if (['completed', 'stopped'].includes(campaign.status)) {
      return fail(res, 'Cannot edit steps of a completed or stopped campaign', 400);
    }

    const step = await DripStep.findOne({ _id: stepId, campaignId: campaign._id });
    if (!step) {
      return fail(res, 'Step not found in this campaign', 404);
    }

    if (templateId) {
      const template = await Template.findOne({
        _id: templateId,
        $or: [{ userId }, { assignedTo: userId }],
      });
      if (!template) {
        return fail(res, 'Template not found', 404);
      }
      step.templateId = template._id;
    }

    if (dayOffset !== undefined) step.dayOffset = parseInt(dayOffset, 10);
    if (req.body.offsetValue !== undefined) step.offsetValue = Number(req.body.offsetValue);
    if (req.body.offsetUnit !== undefined) step.offsetUnit = req.body.offsetUnit;
    if (req.body.sendTime !== undefined) step.sendTime = req.body.sendTime;
    if (notes !== undefined) step.notes = notes;
    if (mediaType !== undefined) step.mediaType = mediaType;
    if (variableMapping !== undefined) step.variableMapping = variableMapping;

    await step.save();

    // Re-check if all steps in this campaign are approved
    const allSteps = await DripStep.find({ campaignId: campaign._id });
    const templates = await Template.find({ _id: { $in: allSteps.map((s) => s.templateId) } });
    const allApproved = templates.length === allSteps.length && templates.every((t) => t.metaStatus === 'APPROVED');

    if (campaign.status === 'awaiting_approval' && allApproved) {
      campaign.status = 'draft';
      await campaign.save();
    } else if (!allApproved && campaign.status === 'draft') {
      campaign.status = 'awaiting_approval';
      await campaign.save();
    }

    return success(res, { step, allApproved, campaignStatus: campaign.status }, 'Step updated successfully');
  } catch (err) {
    return fail(res, err.message || 'Failed to update step', 500);
  }
};

// ─── Activate Campaign (Snapshot Audience & Schedule Enrollments) ─────────────
exports.activateCampaign = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;
    const campaign = await DripCampaign.findOne({ _id: req.params.id, userId });

    if (!campaign) {
      return fail(res, 'Campaign not found', 404);
    }

    if (['active', 'completed', 'stopped'].includes(campaign.status)) {
      return fail(res, `Campaign is already ${campaign.status}`, 400);
    }

    // 1. Verify all steps have APPROVED templates
    const steps = await DripStep.find({ campaignId: campaign._id }).sort({ order: 1 });
    if (!steps.length) {
      return fail(res, 'Campaign has no steps to execute', 400);
    }

    const templateIds = steps.map((s) => s.templateId);
    const templates = await Template.find({ _id: { $in: templateIds } });
    const unapproved = templates.filter((t) => t.metaStatus !== 'APPROVED');

    if (unapproved.length > 0 || templates.length !== steps.length) {
      return fail(
        res,
        'Cannot activate campaign: all step templates must be approved by Meta first',
        400
      );
    }

    // 2. Snapshot Audience Group Contacts
    const contacts = await Contact.find({
      userId,
      group: { $in: [campaign.audienceGroupId] },
      optedOut: false,
    });

    if (!contacts.length) {
      return fail(res, 'No active contacts found in the selected audience group', 400);
    }

    const baselineDate = campaign.startDate && new Date(campaign.startDate) > new Date()
      ? new Date(campaign.startDate)
      : new Date();

    const isFuture = baselineDate.getTime() > Date.now();
    campaign.status = isFuture ? 'scheduled' : 'active';
    campaign.totalAudience = contacts.length;
    await campaign.save();

    const firstStep = steps[0];
    const user = await User.findById(userId).select('businessHours');
    const userTz = user?.businessHours?.timezone || 'Asia/Kolkata';
    const initialDueAt = calculateStepDueAt(
      baselineDate,
      firstStep,
      campaign.preferredSendTime || '10:00',
      userTz,
      true
    );

    // 3. Batch insert enrollments (1,000 at a time with { ordered: false })
    const enrollmentDocs = contacts.map((c) => ({
      userId,
      campaignId: campaign._id,
      contactId: c._id,
      phone: normalizePhone(c.phone) || String(c.phone).replace(/\D/g, ''),
      currentStepIndex: 0,
      status: 'active',
      enrolledAt: baselineDate, // EXPLICIT baseline matching campaign.startDate!
      nextDueAt: initialDueAt,
      isProcessing: false,
      retryCount: 0,
    }));

    const chunkSize = 1000;
    for (let i = 0; i < enrollmentDocs.length; i += chunkSize) {
      const chunk = enrollmentDocs.slice(i, i + chunkSize);
      try {
        await DripEnrollment.insertMany(chunk, { ordered: false });
      } catch (insertErr) {
        // Ignore duplicate key errors (code 11000)
        if (insertErr.code !== 11000 && !insertErr.writeErrors) {
          console.warn('[Drip Activation] Partial duplicate enrollment ignored:', insertErr.message);
        }
      }
    }

    // Trigger immediate background scheduler cycle for any immediate steps
    runDripSchedulerCycle().catch((schedErr) =>
      console.error('[Drip Trigger] Immediate cycle error on activation:', schedErr.message)
    );

    return success(
      res,
      { campaign, totalEnrolled: contacts.length, status: campaign.status, startDate: baselineDate },
      `Campaign activated successfully with ${contacts.length} contacts enrolled`
    );
  } catch (err) {
    return fail(res, err.message || 'Failed to activate campaign', 500);
  }
};

// ─── Pause Campaign ───────────────────────────────────────────────────────────
exports.pauseCampaign = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;
    const campaign = await DripCampaign.findOne({ _id: req.params.id, userId });

    if (!campaign) {
      return fail(res, 'Campaign not found', 404);
    }

    // Status guard
    if (!['active', 'scheduled'].includes(campaign.status)) {
      return fail(res, `Cannot pause a campaign with status "${campaign.status}"`, 400);
    }

    campaign.status = 'paused';
    campaign.pausedAt = new Date();
    await campaign.save();

    // Primary Defense: Synchronize active enrollments to paused status & clear processing locks
    await DripEnrollment.updateMany(
      { campaignId: campaign._id, status: 'active' },
      { $set: { status: 'paused', isProcessing: false, processingStartedAt: null } }
    );

    return success(res, { campaign }, 'Campaign paused successfully');
  } catch (err) {
    return fail(res, err.message || 'Failed to pause campaign', 500);
  }
};

// ─── Resume Campaign (Timeline Shift Forward) ─────────────────────────────────
exports.resumeCampaign = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;
    const campaign = await DripCampaign.findOne({ _id: req.params.id, userId });

    if (!campaign) {
      return fail(res, 'Campaign not found', 404);
    }

    // Status & Crash-Proof Null Guard
    if (campaign.status !== 'paused' || !campaign.pausedAt) {
      return fail(res, 'Only paused campaigns with a valid pause timestamp can be resumed', 400);
    }

    const pauseDuration = Date.now() - campaign.pausedAt.getTime();

    // Shift all paused enrollments forward by pauseDuration and restore to active
    await DripEnrollment.updateMany(
      { campaignId: campaign._id, status: 'paused' },
      [
        {
          $set: {
            status: 'active',
            isProcessing: false,
            processingStartedAt: null,
            enrolledAt: { $add: ['$enrolledAt', pauseDuration] },
            nextDueAt: { $add: ['$nextDueAt', pauseDuration] },
          },
        },
      ]
    );

    if (campaign.startDate && new Date(campaign.startDate) > new Date()) {
      campaign.startDate = new Date(new Date(campaign.startDate).getTime() + pauseDuration);
    }

    campaign.status = campaign.startDate && new Date(campaign.startDate) > new Date() ? 'scheduled' : 'active';
    campaign.pausedAt = null;
    await campaign.save();

    // Trigger immediate background scheduler cycle for resumed steps
    runDripSchedulerCycle().catch((schedErr) =>
      console.error('[Drip Trigger] Immediate cycle error on resume:', schedErr.message)
    );

    return success(res, { campaign }, 'Campaign resumed and timeline shifted successfully');
  } catch (err) {
    return fail(res, err.message || 'Failed to resume campaign', 500);
  }
};

// ─── Stop Campaign ────────────────────────────────────────────────────────────
exports.stopCampaign = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;
    const campaign = await DripCampaign.findOne({ _id: req.params.id, userId });

    if (!campaign) {
      return fail(res, 'Campaign not found', 404);
    }

    if (!['active', 'scheduled', 'paused'].includes(campaign.status)) {
      return fail(res, `Cannot stop a campaign with status "${campaign.status}"`, 400);
    }

    campaign.status = 'stopped';
    campaign.stoppedAt = new Date();
    await campaign.save();

    // Bulk-update all active and paused enrollments to stopped & clear any stuck processing lock
    await DripEnrollment.updateMany(
      { campaignId: campaign._id, status: { $in: ['active', 'paused'] } },
      { $set: { status: 'stopped', isProcessing: false, processingStartedAt: null } }
    );

    return success(res, { campaign }, 'Campaign stopped and all enrollments terminated');
  } catch (err) {
    return fail(res, err.message || 'Failed to stop campaign', 500);
  }
};

// ─── Campaign Analytics & Step Funnel ─────────────────────────────────────────
exports.getCampaignAnalytics = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;
    const campaign = await DripCampaign.findOne({ _id: req.params.id, userId });

    if (!campaign) {
      return fail(res, 'Campaign not found', 404);
    }

    const steps = await DripStep.find({ campaignId: campaign._id }).sort({ order: 1 });

    const [enrollmentStats, deliveryStats] = await Promise.all([
      DripEnrollment.aggregate([
        { $match: { campaignId: campaign._id } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ]),
      DripDeliveryLog.aggregate([
        { $match: { campaignId: campaign._id } },
        {
          $group: {
            _id: { stepId: '$stepId', status: '$deliveryStatus' },
            count: { $sum: 1 },
            replied: { $sum: { $cond: [{ $ne: ['$repliedAt', null] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const statusCounts = {
      active: 0,
      paused: 0,
      converted: 0,
      opted_out: 0,
      completed: 0,
      stopped: 0,
      failed: 0,
      total: 0,
    };

    enrollmentStats.forEach((s) => {
      if (statusCounts[s._id] !== undefined) {
        statusCounts[s._id] = s.count;
      }
      statusCounts.total += s.count;
    });

    const stepFunnel = steps.map((st) => {
      const stepLogs = deliveryStats.filter((d) => String(d._id.stepId) === String(st._id));
      const sent = stepLogs.reduce((acc, curr) => acc + curr.count, 0);
      const delivered = stepLogs
        .filter((d) => ['delivered', 'read'].includes(d._id.status))
        .reduce((acc, curr) => acc + curr.count, 0);
      const read = stepLogs
        .filter((d) => d._id.status === 'read')
        .reduce((acc, curr) => acc + curr.count, 0);
      const replied = stepLogs.reduce((acc, curr) => acc + curr.replied, 0);

      return {
        stepId: st._id,
        order: st.order,
        dayOffset: st.dayOffset,
        notes: st.notes,
        sent,
        delivered,
        read,
        replied,
        deliveryRate: sent > 0 ? Math.round((delivered / sent) * 100) : 0,
        readRate: sent > 0 ? Math.round((read / sent) * 100) : 0,
      };
    });

    return success(
      res,
      {
        summary: statusCounts,
        stepFunnel,
        campaign,
      },
      'Campaign analytics retrieved successfully'
    );
  } catch (err) {
    return fail(res, err.message || 'Failed to get analytics', 500);
  }
};

// ─── List Paginated Enrollments ───────────────────────────────────────────────
exports.listEnrollments = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;
    const { id } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 25;
    const search = req.query.search || '';
    const status = req.query.status || '';

    const filter = { campaignId: id, userId };
    if (status) filter.status = status;
    if (search) {
      filter.phone = { $regex: search.trim(), $options: 'i' };
    }

    const [enrollments, total] = await Promise.all([
      DripEnrollment.find(filter)
        .populate('contactId', 'name email tags')
        .populate('lastSentStepId', 'order dayOffset')
        .sort({ nextDueAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      DripEnrollment.countDocuments(filter),
    ]);

    return success(
      res,
      {
        enrollments,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
      'Enrollments fetched'
    );
  } catch (err) {
    return fail(res, err.message || 'Failed to list enrollments', 500);
  }
};

// ─── Toggle Individual Enrollment Status (Manual Opt-out / Enable) ────────────
exports.toggleEnrollmentStatus = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;
    const { id, enrollmentId } = req.params;
    const { status } = req.body;

    if (!['active', 'opted_out', 'converted', 'paused'].includes(status)) {
      return fail(res, 'Invalid status update', 400);
    }

    const enrollment = await DripEnrollment.findOne({ _id: enrollmentId, campaignId: id, userId });
    if (!enrollment) {
      return fail(res, 'Enrollment not found', 404);
    }

    enrollment.status = status;
    if (status === 'opted_out') enrollment.optedOutAt = new Date();
    if (status === 'converted') enrollment.convertedAt = new Date();
    enrollment.isProcessing = false;

    await enrollment.save();

    return success(res, { enrollment }, `Enrollment status updated to ${status}`);
  } catch (err) {
    return fail(res, err.message || 'Failed to toggle enrollment status', 500);
  }
};

// ─── Test Send a Single Step Immediately ──────────────────────────────────────
exports.testSendStep = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;
    const { id, stepId } = req.params;
    const { testPhone } = req.body;

    const campaign = await DripCampaign.findOne({ _id: id, userId });
    if (!campaign) return fail(res, 'Campaign not found', 404);

    const step = await DripStep.findOne({ _id: stepId, campaignId: id });
    if (!step) return fail(res, 'Step not found', 404);

    const template = await Template.findById(step.templateId);
    if (!template) return fail(res, 'Template not found', 404);

    const recipientPhone = testPhone || req.user.phone || '';
    if (!recipientPhone) {
      return fail(res, 'Please provide a valid recipient WhatsApp phone number for testing', 400);
    }

    const sampleContact = {
      name: req.user.name || 'Test Customer',
      phone: recipientPhone,
      email: req.user.email || 'test@example.com',
    };
    const params = resolveTemplateVariables(sampleContact, step.variableMapping, template);

    const apiRes = await whatsapp.sendTemplateMessage(
      userId,
      recipientPhone,
      template.whatsappTemplateName,
      template.languageCode || 'en',
      params
    );

    return success(
      res,
      { apiRes, stepOrder: step.order, templateName: template.name },
      `Test message for Step ${step.order} successfully sent to ${recipientPhone}!`
    );
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message || 'Failed to send test message';
    return fail(res, msg, 500);
  }
};

// ─── Fast-Forward / Dispatch Next Step Now for an Enrolled Contact ───────────
exports.dispatchEnrollmentNow = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;
    const { id, enrollmentId } = req.params;

    const campaign = await DripCampaign.findOne({ _id: id, userId });
    if (!campaign) return fail(res, 'Campaign not found', 404);

    const enrollment = await DripEnrollment.findOne({ _id: enrollmentId, campaignId: id, userId });
    if (!enrollment) return fail(res, 'Enrollment not found', 404);

    const steps = await DripStep.find({ campaignId: id }).sort({ order: 1 });
    const currentStep = steps[enrollment.currentStepIndex];

    if (!currentStep) {
      enrollment.status = 'completed';
      await enrollment.save();
      return fail(res, 'All steps in this campaign have already been completed for this contact', 400);
    }

    const template = await Template.findById(currentStep.templateId);
    if (!template) return fail(res, 'Template for this step not found', 404);

    const contact = await Contact.findById(enrollment.contactId);
    const params = resolveTemplateVariables(contact || { name: 'Customer', phone: enrollment.phone }, currentStep.variableMapping, template);

    // Send WhatsApp template
    const apiRes = await whatsapp.sendTemplateMessage(
      userId,
      enrollment.phone,
      template.whatsappTemplateName,
      template.languageCode || 'en',
      params
    );

    const metaMessageId = apiRes?.messages?.[0]?.id || '';
    await DripDeliveryLog.create({
      userId,
      campaignId: id,
      enrollmentId: enrollment._id,
      stepId: currentStep._id,
      contactId: enrollment.contactId,
      phone: enrollment.phone,
      metaMessageId,
      deliveryStatus: 'sent',
      sentAt: new Date(),
    });

    enrollment.lastSentAt = new Date();
    enrollment.lastSentStepId = currentStep._id;
    enrollment.retryCount = 0;
    enrollment.isProcessing = false;

    const nextStep = steps[enrollment.currentStepIndex + 1];
    if (nextStep) {
      enrollment.currentStepIndex += 1;
      const nextBase = enrollment.lastSentAt || new Date();
      const user = await User.findById(userId).select('businessHours');
      const userTz = user?.businessHours?.timezone || 'Asia/Kolkata';
      enrollment.nextDueAt = calculateStepDueAt(nextBase, nextStep, campaign.preferredSendTime || '10:00', userTz, false);
    } else {
      enrollment.status = 'completed';
    }
    await enrollment.save();

    return success(
      res,
      {
        enrollment,
        dispatchedStep: currentStep.order,
        nextStepOrder: nextStep ? nextStep.order : 'COMPLETED',
        metaMessageId,
      },
      `Step ${currentStep.order} (${template.name}) sent now! Contact advanced to Step ${nextStep ? nextStep.order : 'Completed'}.`
    );
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message || 'Failed to dispatch step';
    return fail(res, msg, 500);
  }
};

// ─── Delete Drip Campaign ─────────────────────────────────────────────────────
exports.deleteDripCampaign = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;
    const campaign = await DripCampaign.findOne({ _id: req.params.id, userId });

    if (!campaign) {
      return fail(res, 'Campaign not found', 404);
    }

    // Delete associated steps, enrollments, and delivery logs
    await Promise.all([
      DripStep.deleteMany({ campaignId: campaign._id }),
      DripEnrollment.deleteMany({ campaignId: campaign._id }),
      DripDeliveryLog.deleteMany({ campaignId: campaign._id }),
      DripCampaign.findByIdAndDelete(campaign._id),
    ]);

    return success(res, null, 'Drip campaign and all associated data deleted successfully');
  } catch (err) {
    return fail(res, err.message || 'Failed to delete drip campaign', 500);
  }
};

// ─── Duplicate / Clone Drip Campaign ──────────────────────────────────────────
exports.duplicateCampaign = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;
    const sourceCampaign = await DripCampaign.findOne({ _id: req.params.id, userId });

    if (!sourceCampaign) {
      return fail(res, 'Source drip campaign not found', 404);
    }

    // 1. Create a clone in 'draft' status
    const newCampaign = new DripCampaign({
      userId,
      name: `${sourceCampaign.name} (Copy)`,
      goalDescription: sourceCampaign.goalDescription || '',
      mode: sourceCampaign.mode || 'manual',
      durationDays: sourceCampaign.durationDays || 30,
      startDate: new Date(),
      preferredSendTime: sourceCampaign.preferredSendTime || '10:00',
      audienceGroupId: sourceCampaign.audienceGroupId,
      status: 'draft',
      totalAudience: sourceCampaign.totalAudience || 0,
      totalSteps: sourceCampaign.totalSteps || 0,
      estimatedCost: sourceCampaign.estimatedCost || 0,
      categoryBreakdown: sourceCampaign.categoryBreakdown || { marketingCount: 0, utilityCount: 0 },
    });
    await newCampaign.save();

    // 2. Clone all steps
    const sourceSteps = await DripStep.find({ campaignId: sourceCampaign._id }).sort({ order: 1 });
    const clonedStepsDocs = sourceSteps.map((s) => ({
      campaignId: newCampaign._id,
      order: s.order,
      dayOffset: s.dayOffset ?? 1,
      offsetValue: s.offsetValue !== undefined ? s.offsetValue : (s.dayOffset ?? 1),
      offsetUnit: s.offsetUnit || 'days',
      sendTime: s.sendTime || sourceCampaign.preferredSendTime || '10:00',
      templateId: s.templateId,
      notes: s.notes || '',
      mediaType: s.mediaType || 'text',
      variableMapping: s.variableMapping || [],
    }));

    if (clonedStepsDocs.length > 0) {
      await DripStep.insertMany(clonedStepsDocs);
    }

    const populatedCampaign = await DripCampaign.findById(newCampaign._id)
      .populate('audienceGroupId', 'name contactCount');

    return success(
      res,
      { campaign: populatedCampaign, totalSteps: clonedStepsDocs.length },
      `Campaign "${sourceCampaign.name}" duplicated as draft successfully!`
    );
  } catch (err) {
    return fail(res, err.message || 'Failed to duplicate drip campaign', 500);
  }
};

// ─── Update Drip Campaign Meta ────────────────────────────────────────────────
exports.updateDripCampaign = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;
    const campaign = await DripCampaign.findOne({ _id: req.params.id, userId });

    if (!campaign) {
      return fail(res, 'Drip campaign not found', 404);
    }

    const { name, audienceGroupId, startDate, preferredSendTime, goalDescription, durationDays } = req.body;
    if (name) campaign.name = name.trim();
    if (audienceGroupId) {
      const grp = await ContactGroup.findById(audienceGroupId);
      if (grp) {
        campaign.audienceGroupId = audienceGroupId;
        campaign.totalAudience = grp.contactCount || 0;
      }
    }
    if (startDate) campaign.startDate = new Date(startDate);
    if (preferredSendTime) campaign.preferredSendTime = preferredSendTime;
    if (goalDescription !== undefined) campaign.goalDescription = goalDescription;
    if (durationDays) campaign.durationDays = durationDays;

    await campaign.save();
    const populated = await DripCampaign.findById(campaign._id)
      .populate('audienceGroupId', 'name contactCount');

    return success(res, { campaign: populated }, 'Campaign updated successfully');
  } catch (err) {
    return fail(res, err.message || 'Failed to update campaign', 500);
  }
};

// ─── Enroll Single Contact into Drip Campaign (from Inbox / Contacts) ─────────
exports.enrollSingleContact = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;
    const campaign = await DripCampaign.findOne({ _id: req.params.id, userId });
    if (!campaign) {
      return fail(res, 'Drip campaign not found', 404);
    }

    const { contactId, phone } = req.body;
    let targetPhone = phone;
    let targetContactId = contactId;

    if (contactId && !targetPhone) {
      const contact = await Contact.findById(contactId);
      if (contact) targetPhone = contact.phone;
    } else if (targetPhone && !contactId) {
      const contact = await Contact.findOne({ userId, phone: targetPhone });
      if (contact) targetContactId = contact._id;
    }

    if (!targetPhone) {
      return fail(res, 'Contact ID or Phone is required for enrollment', 400);
    }

    targetPhone = normalizePhone(targetPhone) || String(targetPhone).replace(/\D/g, '');

    const steps = await DripStep.find({ campaignId: campaign._id }).sort({ order: 1 });
    if (!steps.length) {
      return fail(res, 'Cannot enroll: Campaign has no steps configured', 400);
    }

    const user = await User.findById(userId).select('businessHours');
    const userTz = user?.businessHours?.timezone || 'Asia/Kolkata';
    const firstStep = steps[0];
    const initialDueAt = calculateStepDueAt(new Date(), firstStep, campaign.preferredSendTime || '10:00', userTz, true);

    const enrollment = await DripEnrollment.findOneAndUpdate(
      { userId, campaignId: campaign._id, phone: targetPhone },
      {
        $set: {
          contactId: targetContactId,
          currentStepIndex: 0,
          status: 'active',
          enrolledAt: new Date(),
          nextDueAt: initialDueAt,
          isProcessing: false,
          retryCount: 0,
        }
      },
      { upsert: true, new: true }
    );

    // Trigger immediate background scheduler cycle
    runDripSchedulerCycle().catch((schedErr) =>
      console.error('[Drip Trigger] Immediate cycle error on single enrollment:', schedErr.message)
    );

    return success(res, { enrollment }, `Contact +${targetPhone} enrolled into "${campaign.name}" successfully!`);
  } catch (err) {
    return fail(res, err.message || 'Failed to enroll contact', 500);
  }
};

// ─── Manually Dispatch All Due Steps Immediately ─────────────────────────────
exports.dispatchDueSteps = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;
    const { id } = req.params;
    const force = req.body?.force === true;

    const result = await dispatchDueStepsForCampaign(id, userId, force);
    return success(res, result, 'Drip dispatch cycle executed successfully');
  } catch (err) {
    return fail(res, err.message || 'Failed to dispatch due steps', 500);
  }
};

// ─── Retry Failed Enrollments ────────────────────────────────────────────────
exports.retryFailedEnrollments = async (req, res) => {
  try {
    const userId = req.targetUserId || req.user._id;
    const { id } = req.params;

    const campaign = await DripCampaign.findOne({ _id: id, userId });
    if (!campaign) {
      return fail(res, 'Campaign not found', 404);
    }

    const result = await DripEnrollment.updateMany(
      { campaignId: id, status: 'failed' },
      {
        $set: {
          status: 'active',
          retryCount: 0,
          nextDueAt: new Date(),
          isProcessing: false,
          processingStartedAt: null,
        },
      }
    );

    // Trigger immediate background scheduler cycle
    runDripSchedulerCycle().catch(() => {});

    return success(
      res,
      { modifiedCount: result.modifiedCount },
      `Reset ${result.modifiedCount} failed contact(s) to active and queued for immediate delivery!`
    );
  } catch (err) {
    return fail(res, err.message || 'Failed to retry failed contacts', 500);
  }
};


