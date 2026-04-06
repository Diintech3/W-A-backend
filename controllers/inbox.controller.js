const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { success, fail } = require('../utils/apiResponse');
const whatsapp = require('../services/whatsapp.service');
const { emitToUser } = require('../services/socket.service');

exports.listConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({ userId: req.user._id }).sort({
      lastMessageAt: -1,
    });
    return success(res, { conversations }, 'Conversations');
  } catch (e) {
    return fail(res, e.message || 'Failed to load conversations', 500);
  }
};

exports.getMessages = async (req, res) => {
  try {
    const conv = await Conversation.findOne({ _id: req.params.id, userId: req.user._id });
    if (!conv) return fail(res, 'Conversation not found', 404);

    const messages = await Message.find({ conversationId: conv._id }).sort({ createdAt: 1 });

    conv.unreadCount = 0;
    await conv.save();

    emitToUser(String(req.user._id), 'inbox:update', { conversationId: String(conv._id) });

    return success(res, { messages, conversation: conv }, 'Messages');
  } catch (e) {
    return fail(res, e.message || 'Failed to load messages', 500);
  }
};

exports.reply = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return fail(res, 'Message text required');

    const conv = await Conversation.findOne({ _id: req.params.id, userId: req.user._id });
    if (!conv) return fail(res, 'Conversation not found', 404);

    const phone = conv.customerPhone.replace(/\D/g, '');

    const msgDoc = await Message.create({
      userId: req.user._id,
      conversationId: conv._id,
      direction: 'outbound',
      from: 'agent',
      to: phone,
      body: text,
      type: 'text',
      status: 'pending',
    });

    try {
      const apiRes = await whatsapp.sendTextMessage(req.user._id, phone, text);
      msgDoc.status = 'sent';
      msgDoc.whatsappMessageId = apiRes?.messages?.[0]?.id || '';
      await msgDoc.save();
    } catch (err) {
      msgDoc.status = 'failed';
      msgDoc.errorReason = err.response?.data?.error?.message || err.message;
      await msgDoc.save();
      return fail(res, msgDoc.errorReason || 'Failed to send', 502);
    }

    conv.lastMessage = text;
    conv.lastMessageAt = new Date();
    conv.botContext = { flowId: null, currentNodeId: '', awaitingMenu: false };
    await conv.save();

    emitToUser(String(req.user._id), 'inbox:newMessage', {
      conversationId: String(conv._id),
      message: msgDoc,
    });
    emitToUser(String(req.user._id), 'inbox:update', { conversationId: String(conv._id) });

    return success(res, { message: msgDoc }, 'Reply sent');
  } catch (e) {
    return fail(res, e.message || 'Reply failed', 500);
  }
};

exports.assign = async (req, res) => {
  try {
    const { assignedAgent } = req.body;
    const conv = await Conversation.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { assignedAgent: assignedAgent || '' },
      { new: true }
    );
    if (!conv) return fail(res, 'Conversation not found', 404);

    emitToUser(String(req.user._id), 'inbox:update', { conversationId: String(conv._id) });

    return success(res, { conversation: conv }, 'Assignment updated');
  } catch (e) {
    return fail(res, e.message || 'Assign failed', 500);
  }
};
