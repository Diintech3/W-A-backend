const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema(
  {
    // Template owner (client ya admin — jo use kar raha hai)
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Agar admin ne kisi specific client ke liye banaya hai
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    // Kisne banaya (admin reference)
    createdByAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, required: true, trim: true },
    whatsappTemplateName: { type: String, required: true, trim: true },
    languageCode: { type: String, default: 'en' },
    category: { type: String, default: 'MARKETING' },
    bodyPreview: { type: String, default: '' },
    headerText: { type: String, default: '' },
    footerText: { type: String, default: '' },
    parameterFormat: { type: String, default: 'POSITIONAL' },
    sampleParams: [{ key: String, value: String }],
    // Meta se approval status
    metaStatus: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'DISABLED', 'DRAFT'],
      default: 'DRAFT',
    },
    // Meta ne template ID diya (create hone ke baad)
    metaTemplateId: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Template', templateSchema);
