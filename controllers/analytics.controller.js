const Message = require('../models/Message');
const Campaign = require('../models/Campaign');
const { success, fail } = require('../utils/apiResponse');

exports.overview = async (req, res) => {
  try {
    const userId = req.user._id;
    const [agg] = await Message.aggregate([
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

    const totals = agg || {
      total: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      pending: 0,
    };

    const outbound = totals.total || 0;
    const deliveredPct = outbound ? Math.round(((totals.delivered + totals.read + totals.sent) / outbound) * 100) : 0;
    const readPct = outbound ? Math.round((totals.read / outbound) * 100) : 0;
    const failedPct = outbound ? Math.round((totals.failed / outbound) * 100) : 0;

    return success(
      res,
      {
        totalMessages: outbound,
        deliveredPercent: Math.min(100, deliveredPct),
        readPercent: Math.min(100, readPct),
        failedPercent: failedPct,
        breakdown: totals,
      },
      'Overview'
    );
  } catch (e) {
    return fail(res, e.message || 'Overview failed', 500);
  }
};

exports.campaignStats = async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('name status totalContacts sent delivered read failed createdAt');

    return success(res, { campaigns }, 'Campaign stats');
  } catch (e) {
    return fail(res, e.message || 'Campaign stats failed', 500);
  }
};

exports.timeline = async (req, res) => {
  try {
    const userId = req.user._id;
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const rows = await Message.aggregate([
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

    const timeline = rows.map((r) => ({ date: r._id, messages: r.count }));
    return success(res, { timeline }, 'Timeline');
  } catch (e) {
    return fail(res, e.message || 'Timeline failed', 500);
  }
};
