const mongoose = require('mongoose');

const dripDeliveryLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'DripCampaign', required: true, index: true },
    enrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'DripEnrollment', required: true, index: true },
    stepId: { type: mongoose.Schema.Types.ObjectId, ref: 'DripStep', required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
    phone: { type: String, required: true },
    metaMessageId: { type: String, default: '', index: true },
    deliveryStatus: {
      type: String,
      enum: ['sent', 'delivered', 'read', 'failed'],
      default: 'sent',
      index: true,
    },
    errorReason: { type: String, default: '' },
    repliedAt: { type: Date, default: null },
    sentAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DripDeliveryLog', dripDeliveryLogSchema);
