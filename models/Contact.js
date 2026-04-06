const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, default: '', trim: true },
    tags: [{ type: String, trim: true }],
    group: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ContactGroup' }],
    optedOut: { type: Boolean, default: false },
  },
  { timestamps: true }
);

contactSchema.index({ userId: 1, phone: 1 }, { unique: true });

module.exports = mongoose.model('Contact', contactSchema);
