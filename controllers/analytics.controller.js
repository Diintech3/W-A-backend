const Message = require('../models/Message');
const Campaign = require('../models/Campaign');
const DripCampaign = require('../models/DripCampaign');
const DripEnrollment = require('../models/DripEnrollment');
const DripDeliveryLog = require('../models/DripDeliveryLog');
const DripStep = require('../models/DripStep');
const mongoose = require('mongoose');
const { success, fail } = require('../utils/apiResponse');

exports.overview = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.targetUserId || req.user._id);

    // 1. Message collection aggregation (Standard Outbound & Direct/Bot)
    const [msgAgg] = await Message.aggregate([
      { $match: { userId, direction: 'outbound' } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          read: { $sum: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        },
      },
    ]);

    // 2. Drip Delivery Logs aggregation
    const [dripAgg] = await DripDeliveryLog.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          sent: { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'sent'] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $in: ['$deliveryStatus', ['delivered', 'read']] }, 1, 0] } },
          read: { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'read'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'failed'] }, 1, 0] } },
          replied: { $sum: { $cond: [{ $ne: ['$repliedAt', null] }, 1, 0] } },
        },
      },
    ]);

    // 3. Drip Enrollment summary stats
    const [enrollmentAgg] = await DripEnrollment.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          optedOut: { $sum: { $cond: [{ $eq: ['$status', 'opted_out'] }, 1, 0] } },
          paused: { $sum: { $cond: [{ $eq: ['$status', 'paused'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        },
      },
    ]);

    const activeDripCampaignsCount = await DripCampaign.countDocuments({ userId, status: 'active' });
    const totalDripCampaignsCount = await DripCampaign.countDocuments({ userId });

    const msgTotals = msgAgg || { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, pending: 0 };
    const dripTotals = dripAgg || { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, replied: 0 };
    const enrollTotals = enrollmentAgg || { total: 0, active: 0, converted: 0, completed: 0, optedOut: 0, paused: 0, failed: 0 };

    // Total outbound across both broadcast + drip
    const outbound = (msgTotals.total || 0);
    const deliveredCount = (msgTotals.delivered + msgTotals.read + msgTotals.sent);
    const deliveredPct = outbound ? Math.round((deliveredCount / outbound) * 100) : 0;
    const readPct = outbound ? Math.round((msgTotals.read / outbound) * 100) : 0;
    const failedPct = outbound ? Math.round((msgTotals.failed / outbound) * 100) : 0;

    const dripTotal = dripTotals.total || 0;
    const dripDeliveredPct = dripTotal ? Math.round(((dripTotals.delivered + dripTotals.sent) / dripTotal) * 100) : 0;
    const dripReadPct = dripTotal ? Math.round((dripTotals.read / dripTotal) * 100) : 0;
    const dripReplyPct = dripTotal ? Math.round((dripTotals.replied / dripTotal) * 100) : 0;

    return success(
      res,
      {
        totalMessages: outbound,
        deliveredPercent: Math.min(100, deliveredPct),
        readPercent: Math.min(100, readPct),
        failedPercent: failedPct,
        breakdown: msgTotals,
        drip: {
          totalMessages: dripTotal,
          deliveredPercent: Math.min(100, dripDeliveredPct),
          readPercent: Math.min(100, dripReadPct),
          replyPercent: Math.min(100, dripReplyPct),
          repliedCount: dripTotals.replied,
          failedCount: dripTotals.failed,
          totalCampaigns: totalDripCampaignsCount,
          activeCampaigns: activeDripCampaignsCount,
          enrollments: enrollTotals,
          conversionRate: enrollTotals.total ? Math.round((enrollTotals.converted / enrollTotals.total) * 100) : 0,
        },
      },
      'Overview'
    );
  } catch (e) {
    return fail(res, e.message || 'Overview failed', 500);
  }
};

exports.campaignStats = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.targetUserId || req.user._id);
    const campaigns = await Campaign.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('name status totalContacts sent delivered read failed createdAt');

    return success(res, { campaigns }, 'Campaign stats');
  } catch (e) {
    return fail(res, e.message || 'Campaign stats failed', 500);
  }
};

exports.dripAnalytics = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.targetUserId || req.user._id);

    // 1. Fetch all user drip campaigns
    const campaigns = await DripCampaign.find({ userId })
      .populate('audienceGroupId', 'name contactCount')
      .sort({ createdAt: -1 });

    const campaignIds = campaigns.map((c) => c._id);

    // 2. Aggregate enrollments by campaign & status
    const enrollmentStats = await DripEnrollment.aggregate([
      { $match: { campaignId: { $in: campaignIds } } },
      {
        $group: {
          _id: { campaignId: '$campaignId', status: '$status' },
          count: { $sum: 1 },
        },
      },
    ]);

    // 3. Aggregate delivery logs by campaign & status
    const deliveryStats = await DripDeliveryLog.aggregate([
      { $match: { campaignId: { $in: campaignIds } } },
      {
        $group: {
          _id: { campaignId: '$campaignId', status: '$deliveryStatus' },
          count: { $sum: 1 },
          replied: { $sum: { $cond: [{ $ne: ['$repliedAt', null] }, 1, 0] } },
        },
      },
    ]);

    // 4. Fetch all steps per campaign
    const steps = await DripStep.find({ campaignId: { $in: campaignIds } })
      .populate('templateId', 'name whatsappTemplateName category')
      .sort({ order: 1 });

    const stepsMap = new Map();
    for (const st of steps) {
      const cid = String(st.campaignId);
      if (!stepsMap.has(cid)) stepsMap.set(cid, []);
      stepsMap.get(cid).push(st);
    }

    // Process summary & per-campaign metrics
    let totalEnrolled = 0;
    let totalActiveEnrolled = 0;
    let totalConverted = 0;
    let totalCompleted = 0;
    let totalOptedOut = 0;
    let totalPausedEnrolled = 0;
    let totalFailedEnrolled = 0;

    let totalSentMessages = 0;
    let totalDeliveredMessages = 0;
    let totalReadMessages = 0;
    let totalRepliedMessages = 0;
    let totalFailedMessages = 0;

    const enrichedCampaigns = campaigns.map((camp) => {
      const cid = String(camp._id);

      // Status breakdown for this campaign
      const campEnrollments = enrollmentStats.filter((e) => String(e._id.campaignId) === cid);
      const enrollCounts = {
        total: 0,
        active: 0,
        converted: 0,
        completed: 0,
        opted_out: 0,
        paused: 0,
        failed: 0,
      };
      campEnrollments.forEach((e) => {
        const st = e._id.status;
        if (enrollCounts[st] !== undefined) enrollCounts[st] = e.count;
        enrollCounts.total += e.count;
      });

      // Delivery breakdown for this campaign
      const campLogs = deliveryStats.filter((d) => String(d._id.campaignId) === cid);
      let sent = 0;
      let delivered = 0;
      let read = 0;
      let replied = 0;
      let failed = 0;

      campLogs.forEach((l) => {
        const st = l._id.status;
        const cnt = l.count;
        if (st === 'sent') sent += cnt;
        else if (st === 'delivered') delivered += cnt;
        else if (st === 'read') read += cnt;
        else if (st === 'failed') failed += cnt;
        replied += (l.replied || 0);
      });

      const totalDispatched = sent + delivered + read + failed;
      const deliveryRate = totalDispatched > 0 ? Math.round(((delivered + read + sent) / totalDispatched) * 100) : 0;
      const readRate = totalDispatched > 0 ? Math.round((read / totalDispatched) * 100) : 0;
      const replyRate = totalDispatched > 0 ? Math.round((replied / totalDispatched) * 100) : 0;
      const conversionRate = enrollCounts.total > 0 ? Math.round((enrollCounts.converted / enrollCounts.total) * 100) : 0;

      // Accumulate totals
      totalEnrolled += enrollCounts.total;
      totalActiveEnrolled += enrollCounts.active;
      totalConverted += enrollCounts.converted;
      totalCompleted += enrollCounts.completed;
      totalOptedOut += enrollCounts.opted_out;
      totalPausedEnrolled += enrollCounts.paused;
      totalFailedEnrolled += enrollCounts.failed;

      totalSentMessages += (sent + delivered + read);
      totalDeliveredMessages += (delivered + read);
      totalReadMessages += read;
      totalRepliedMessages += replied;
      totalFailedMessages += failed;

      const campSteps = stepsMap.get(cid) || [];

      return {
        _id: camp._id,
        name: camp.name,
        goalDescription: camp.goalDescription,
        mode: camp.mode,
        status: camp.status,
        durationDays: camp.durationDays,
        preferredSendTime: camp.preferredSendTime,
        startDate: camp.startDate,
        totalAudience: camp.totalAudience,
        totalSteps: camp.totalSteps || campSteps.length,
        createdAt: camp.createdAt,
        audienceGroup: camp.audienceGroupId,
        stats: {
          enrollments: enrollCounts,
          delivery: {
            totalDispatched,
            sent,
            delivered,
            read,
            replied,
            failed,
            deliveryRate,
            readRate,
            replyRate,
            conversionRate,
          },
        },
        steps: campSteps.map((s) => ({
          _id: s._id,
          order: s.order,
          dayOffset: s.dayOffset,
          offsetValue: s.offsetValue,
          offsetUnit: s.offsetUnit,
          notes: s.notes,
          templateName: s.templateId?.name || 'Template',
          templateCategory: s.templateId?.category || 'MARKETING',
        })),
      };
    });

    const totalDispatchedAll = totalSentMessages + totalFailedMessages;
    const globalDeliveryRate = totalDispatchedAll > 0 ? Math.round((totalDeliveredMessages / totalDispatchedAll) * 100) : 0;
    const globalReadRate = totalDispatchedAll > 0 ? Math.round((totalReadMessages / totalDispatchedAll) * 100) : 0;
    const globalReplyRate = totalDispatchedAll > 0 ? Math.round((totalRepliedMessages / totalDispatchedAll) * 100) : 0;
    const globalConversionRate = totalEnrolled > 0 ? Math.round((totalConverted / totalEnrolled) * 100) : 0;

    return success(
      res,
      {
        summary: {
          totalCampaigns: campaigns.length,
          activeCampaigns: campaigns.filter((c) => c.status === 'active').length,
          scheduledCampaigns: campaigns.filter((c) => c.status === 'scheduled').length,
          pausedCampaigns: campaigns.filter((c) => c.status === 'paused').length,
          completedCampaigns: campaigns.filter((c) => c.status === 'completed').length,
          totalEnrolled,
          activeEnrolled: totalActiveEnrolled,
          converted: totalConverted,
          completed: totalCompleted,
          optedOut: totalOptedOut,
          pausedEnrolled: totalPausedEnrolled,
          failedEnrolled: totalFailedEnrolled,
          conversionRate: globalConversionRate,
        },
        delivery: {
          totalDispatched: totalDispatchedAll,
          sent: totalSentMessages,
          delivered: totalDeliveredMessages,
          read: totalReadMessages,
          replied: totalRepliedMessages,
          failed: totalFailedMessages,
          deliveryRate: globalDeliveryRate,
          readRate: globalReadRate,
          replyRate: globalReplyRate,
        },
        campaigns: enrichedCampaigns,
      },
      'Drip analytics fetched successfully'
    );
  } catch (e) {
    return fail(res, e.message || 'Drip analytics failed', 500);
  }
};

exports.timeline = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.targetUserId || req.user._id);
    const since = new Date();
    since.setDate(since.getDate() - 30);

    // 1. Message timeline (Broadcast & Inbound/Outbound)
    const msgRows = await Message.aggregate([
      {
        $match: {
          userId,
          direction: 'outbound',
          createdAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // 2. Drip logs timeline
    const dripRows = await DripDeliveryLog.aggregate([
      {
        $match: {
          userId,
          sentAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$sentAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const dateMap = new Map();

    msgRows.forEach((r) => {
      dateMap.set(r._id, { date: r._id, messages: r.count, broadcast: r.count, drip: 0 });
    });

    dripRows.forEach((r) => {
      const existing = dateMap.get(r._id) || { date: r._id, messages: 0, broadcast: 0, drip: 0 };
      existing.drip = r.count;
      // Total includes broadcast messages + drip messages
      existing.messages = Math.max(existing.messages, existing.broadcast) + (existing.broadcast > 0 ? 0 : r.count);
      dateMap.set(r._id, existing);
    });

    // Sort by date ascending
    const timeline = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    return success(res, { timeline }, 'Timeline');
  } catch (e) {
    return fail(res, e.message || 'Timeline failed', 500);
  }
};

