const mongoose = require('mongoose');

const photoshareFolderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    startTime: { type: Date, default: null },
    endTime: { type: Date, default: null },
    linkCode: { type: String, required: true, unique: true, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PhotoshareFolder', photoshareFolderSchema);
