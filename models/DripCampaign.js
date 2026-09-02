const mongoose = require('mongoose');

const dripCampaignSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    goalDescription: { type: String, default: '', trim: true },
    mode: { type: String, enum: ['manual', 'ai'], required: true, default: 'manual' },
    durationDays: { type: Number, default: 30 },
    startDate: { type: Date, default: Date.now },
    preferredSendTime: { type: String, default: '10:00' }, // HH:mm format, e.g. "10:30"
    pausedAt: { type: Date, default: null },
    stoppedAt: { type: Date, default: null },
    audienceGroupId: { type: mongoose.Schema.Types.ObjectId, ref: 'ContactGroup', required: true, index: true },
    status: {
      type: String,
      enum: ['draft', 'awaiting_approval', 'scheduled', 'active', 'paused', 'completed', 'stopped'],
      default: 'draft',
      index: true,
    },
    totalAudience: { type: Number, default: 0 },
    totalSteps: { type: Number, default: 0 },
    estimatedCost: { type: Number, default: 0 },
    categoryBreakdown: {
      marketingCount: { type: Number, default: 0 },
      utilityCount: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DripCampaign', dripCampaignSchema);
