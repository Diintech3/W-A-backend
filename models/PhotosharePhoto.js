const mongoose = require('mongoose');

const photosharePhotoSchema = new mongoose.Schema(
  {
    folderId: { type: mongoose.Schema.Types.ObjectId, ref: 'PhotoshareFolder', required: true, index: true },
    senderName: { type: String, default: '' },
    senderPhone: { type: String, required: true },
    photoUrl: { type: String, required: true },
    caption: { type: String, default: '' },
    isValid: { type: Boolean, default: true },
    moderationReason: { type: String, default: '' },
    whatsappMessageId: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PhotosharePhoto', photosharePhotoSchema);
