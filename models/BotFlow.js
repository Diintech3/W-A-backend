const mongoose = require('mongoose');

const botOptionSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    value: { type: String, required: true },
    nextNodeId: { type: String, default: '' },
  },
  { _id: false }
);

const botNodeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: { type: String, enum: ['message', 'menu', 'condition'], required: true },
    content: { type: String, default: '' },
    options: [botOptionSchema],
    nextNodeId: { type: String, default: '' },
  },
  { _id: false }
);

const botFlowSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    triggerKeyword: { type: String, default: 'hi', trim: true, lowercase: true },
    nodes: [botNodeSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model('BotFlow', botFlowSchema);
