const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    from: { type: String, default: '' },
    to: { type: String, default: '' },
    body: { type: String, default: '' },
    type: { type: String, default: 'text' },
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
      default: 'pending',
    },
    whatsappMessageId: { type: String, default: '' },
    errorReason: { type: String, default: '' },
  },
  { timestamps: true }
);

messageSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
