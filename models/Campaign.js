const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    targetGroup: { type: mongoose.Schema.Types.ObjectId, ref: 'ContactGroup', required: true },
    template: { type: mongoose.Schema.Types.ObjectId, ref: 'Template', required: true },
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'running', 'completed', 'failed'],
      default: 'draft',
    },
    scheduledAt: { type: Date, default: null },
    totalContacts: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    read: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Campaign', campaignSchema);
