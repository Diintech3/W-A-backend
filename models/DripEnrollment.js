const mongoose = require('mongoose');

const dripEnrollmentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'DripCampaign', required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    phone: { type: String, required: true, index: true },
    currentStepIndex: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['active', 'converted', 'opted_out', 'completed', 'paused', 'stopped', 'failed'],
      default: 'active',
      index: true,
    },
    enrolledAt: { type: Date, required: true }, // Explicitly set to campaign.startDate baseline
    nextDueAt: { type: Date, required: true, index: true },
    lastSentAt: { type: Date, default: null },
    lastSentStepId: { type: mongoose.Schema.Types.ObjectId, ref: 'DripStep', default: null },
    convertedAt: { type: Date, default: null },
    optedOutAt: { type: Date, default: null },

    // Concurrency lock & error tracking
    isProcessing: { type: Boolean, default: false, index: true },
    processingStartedAt: { type: Date, default: null },
    retryCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Unique compound index: prevents duplicate enrollments per contact per campaign
dripEnrollmentSchema.index({ campaignId: 1, contactId: 1 }, { unique: true });

module.exports = mongoose.model('DripEnrollment', dripEnrollmentSchema);
