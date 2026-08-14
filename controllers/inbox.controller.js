const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { success, fail } = require('../utils/apiResponse');
const whatsapp = require('../services/whatsapp.service');
const { emitToUser } = require('../services/socket.service');

exports.listConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({ userId: req.targetUserId }).sort({
      lastMessageAt: -1,
    });
    return success(res, { conversations }, 'Conversations');
  } catch (e) {
    return fail(res, e.message || 'Failed to load conversations', 500);
  }
};

exports.getMessages = async (req, res) => {
  try {
    const conv = await Conversation.findOne({ _id: req.params.id, userId: req.targetUserId });
    if (!conv) return fail(res, 'Conversation not found', 404);

    const messages = await Message.find({ conversationId: conv._id }).sort({ createdAt: 1 });

    conv.unreadCount = 0;
    await conv.save();

    emitToUser(String(req.user._id), 'inbox:update', { conversationId: String(conv._id) });
    if (String(req.user._id) !== String(req.targetUserId)) {
      emitToUser(String(req.targetUserId), 'inbox:update', { conversationId: String(conv._id) });
    }

    return success(res, { messages, conversation: conv }, 'Messages');
  } catch (e) {
    return fail(res, e.message || 'Failed to load messages', 500);
  }
};

exports.reply = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return fail(res, 'Message text required');

    const conv = await Conversation.findOne({ _id: req.params.id, userId: req.targetUserId });
    if (!conv) return fail(res, 'Conversation not found', 404);

    const phone = conv.customerPhone.replace(/\D/g, '');

    const msgDoc = await Message.create({
      userId: req.targetUserId,
      conversationId: conv._id,
      direction: 'outbound',
      from: 'agent',
      to: phone,
      body: text,
      type: 'text',
      status: 'pending',
    });

    try {
      const apiRes = await whatsapp.sendTextMessage(req.targetUserId, phone, text);
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
    conv.isAIPaused = true; // Auto-pause AI when human replies
    await conv.save();

    emitToUser(String(req.user._id), 'inbox:newMessage', {
      conversationId: String(conv._id),
      message: msgDoc,
    });
    emitToUser(String(req.user._id), 'inbox:update', { conversationId: String(conv._id) });
    if (String(req.user._id) !== String(req.targetUserId)) {
      emitToUser(String(req.targetUserId), 'inbox:newMessage', {
        conversationId: String(conv._id),
        message: msgDoc,
      });
      emitToUser(String(req.targetUserId), 'inbox:update', { conversationId: String(conv._id) });
    }

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

exports.toggleAiState = async (req, res) => {
  try {
    const { isAIPaused } = req.body;
    const conv = await Conversation.findOneAndUpdate(
      { _id: req.params.id, userId: req.targetUserId },
      { isAIPaused: Boolean(isAIPaused) },
      { new: true }
    );
    if (!conv) return fail(res, 'Conversation not found', 404);

    emitToUser(String(req.user._id), 'inbox:update', { conversationId: String(conv._id) });
    if (String(req.user._id) !== String(req.targetUserId)) {
      emitToUser(String(req.targetUserId), 'inbox:update', { conversationId: String(conv._id) });
    }
    return success(res, { conversation: conv }, 'AI state updated');
  } catch (e) {
    return fail(res, e.message || 'Toggle AI failed', 500);
  }
};

exports.sendTemplate = async (req, res) => {
  try {
    const { phone, templateName, language, variables } = req.body;
    if (!phone || !templateName) {
      return fail(res, 'Phone number and template name are required', 400);
    }

    const targetUserId = req.targetUserId || req.user._id;
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (!cleanPhone) {
      return fail(res, 'Invalid phone number', 400);
    }

    let apiRes;
    try {
      apiRes = await whatsapp.sendTemplateMessage(
        targetUserId,
        cleanPhone,
        templateName.trim(),
        language || 'en',
        variables || []
      );
    } catch (err) {
      const errorMsg = err.response?.data?.error?.message || err.message || 'Failed to send template message via WhatsApp';
      return fail(res, errorMsg, 502);
    }

    const wamid = apiRes?.messages?.[0]?.id || '';

    let conv = await Conversation.findOne({ userId: targetUserId, customerPhone: cleanPhone });
    if (!conv) {
      conv = await Conversation.create({
        userId: targetUserId,
        customerPhone: cleanPhone,
        customerName: '',
        lastMessage: `[Template: ${templateName}]`,
        lastMessageAt: new Date(),
        unreadCount: 0,
      });
    } else {
      conv.lastMessage = `[Template: ${templateName}]`;
      conv.lastMessageAt = new Date();
      await conv.save();
    }

    const msgDoc = await Message.create({
      userId: targetUserId,
      conversationId: conv._id,
      direction: 'outbound',
      from: 'business',
      to: cleanPhone,
      body: `Template: ${templateName}`,
      type: 'template',
      status: 'sent',
      whatsappMessageId: wamid,
    });

    emitToUser(String(req.user._id), 'inbox:newMessage', {
      conversationId: String(conv._id),
      message: msgDoc,
    });
    emitToUser(String(req.user._id), 'inbox:update', { conversationId: String(conv._id) });
    if (String(req.user._id) !== String(targetUserId)) {
      emitToUser(String(targetUserId), 'inbox:newMessage', {
        conversationId: String(conv._id),
        message: msgDoc,
      });
      emitToUser(String(targetUserId), 'inbox:update', { conversationId: String(conv._id) });
    }

    return success(
      res,
      {
        conversationId: String(conv._id),
        messageId: wamid || String(msgDoc._id),
        status: 'sent',
        message: msgDoc,
      },
      'Template message sent successfully',
      200
    );
  } catch (e) {
    return fail(res, e.message || 'Failed to send template', 500);
  }
};

