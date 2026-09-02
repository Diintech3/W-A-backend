const mongoose = require('mongoose');

const dripStepSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'DripCampaign', required: true, index: true },
    dayOffset: { type: Number, required: true, default: 1 }, // Legacy compatibility
    offsetValue: { type: Number, required: true, default: 1 }, // Number of minutes/hours/days
    offsetUnit: { type: String, enum: ['minutes', 'hours', 'days'], default: 'days' },
    sendTime: { type: String, default: '' }, // Optional override e.g. "14:30"
    order: { type: Number, required: true },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Template', required: true },
    notes: { type: String, default: '' },
    mediaType: { type: String, enum: ['text', 'image', 'video', 'document'], default: 'text' },
    variableMapping: [
      {
        position: { type: Number, required: true }, // e.g. 1 for {{1}}, 2 for {{2}}
        source: { type: String, required: true }, // e.g. "contact.name", "contact.phone", "contact.email", "custom"
        fallback: { type: String, default: '' }, // Fallback if contact field is missing
      },
    ],
  },
  { timestamps: true }
);

dripStepSchema.index({ campaignId: 1, order: 1 });

module.exports = mongoose.model('DripStep', dripStepSchema);
