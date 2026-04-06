const Message = require('../models/Message');
const { success, fail } = require('../utils/apiResponse');
const { uploadBuffer } = require('../services/r2.service');
const whatsapp = require('../services/whatsapp.service');

exports.listMessages = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const campaignId = req.query.campaignId;

    const filter = { userId: req.user._id };
    if (campaignId) filter.campaignId = campaignId;

    const [messages, total] = await Promise.all([
      Message.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Message.countDocuments(filter),
    ]);

    return success(res, { messages, pagination: { page, limit, total } }, 'Messages');
  } catch (e) {
    return fail(res, e.message || 'Failed to list messages', 500);
  }
};

exports.sendMediaMessage = async (req, res) => {
  try {
    const { to, type, caption } = req.body;
    if (!to) return fail(res, 'Recipient phone is required');
    if (!req.file?.buffer) return fail(res, 'Media file is required');

    const uploaded = await uploadBuffer({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      folder: `users/${req.user._id}/media`,
    });

    const mediaType = ['image', 'video', 'audio', 'document'].includes(type) ? type : 'image';
    const response = await whatsapp.sendMediaMessage(
      req.user._id,
      to,
      mediaType,
      uploaded.url,
      caption || ''
    );

    const msg = await Message.create({
      userId: req.user._id,
      direction: 'outbound',
      from: 'business',
      to: String(to).replace(/\D/g, ''),
      body: caption || `[${mediaType}] ${uploaded.url}`,
      type: mediaType,
      status: 'sent',
      whatsappMessageId: response?.messages?.[0]?.id || '',
    });

    return success(
      res,
      { message: msg, media: uploaded, whatsapp: response },
      'Media uploaded to R2 and message sent'
    );
  } catch (e) {
    return fail(res, e.message || 'Failed to send media message', 500);
  }
};
