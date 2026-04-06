const axios = require('axios');
const User = require('../models/User');

const apiVersion = () => process.env.WHATSAPP_API_VERSION || 'v19.0';

async function getCreds(userId) {
  const user = await User.findById(userId).select('+whatsappAccessToken');
  if (!user?.whatsappPhoneNumberId || !user?.whatsappAccessToken) {
    const err = new Error('WhatsApp not connected. Add Phone Number ID and Access Token.');
    err.statusCode = 400;
    throw err;
  }
  return {
    phoneNumberId: user.whatsappPhoneNumberId,
    token: user.whatsappAccessToken,
  };
}

function graphUrl(phoneNumberId, path = '') {
  const base = `https://graph.facebook.com/${apiVersion()}/${phoneNumberId}`;
  return path ? `${base}/${path}` : base;
}

async function sendTextMessage(userId, to, message) {
  const { phoneNumberId, token } = await getCreds(userId);
  const toNum = String(to).replace(/\D/g, '');
  const url = graphUrl(phoneNumberId, 'messages');
  const { data } = await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toNum,
      type: 'text',
      text: { preview_url: false, body: String(message).slice(0, 4096) },
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return data;
}

function buildTemplateComponents(params) {
  if (!params || !params.length) {
    return [{ type: 'body', parameters: [] }];
  }
  const first = params[0];
  if (typeof first === 'string') {
    return [
      {
        type: 'body',
        parameters: params.map((text) => ({ type: 'text', text: String(text) })),
      },
    ];
  }
  return [
    {
      type: 'body',
      parameters: params.map((p) => ({
        type: 'text',
        text: String(p.text ?? p.value ?? ''),
        parameter_name: p.parameter_name || p.key,
      })),
    },
  ];
}

async function sendTemplateMessage(userId, to, templateName, languageCode, params) {
  const { phoneNumberId, token } = await getCreds(userId);
  const toNum = String(to).replace(/\D/g, '');
  const url = graphUrl(phoneNumberId, 'messages');
  const bodyParams = buildTemplateComponents(params);
  const templatePayload = {
    name: templateName,
    language: { code: languageCode || 'en' },
  };
  if (bodyParams[0]?.parameters?.length) {
    templatePayload.components = bodyParams;
  }
  const { data } = await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      to: toNum,
      type: 'template',
      template: templatePayload,
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return data;
}

async function sendMediaMessage(userId, to, type, mediaUrl, caption) {
  const { phoneNumberId, token } = await getCreds(userId);
  const toNum = String(to).replace(/\D/g, '');
  const url = graphUrl(phoneNumberId, 'messages');
  const mediaType = ['image', 'video', 'audio', 'document'].includes(type) ? type : 'image';
  const payload = {
    messaging_product: 'whatsapp',
    to: toNum,
    type: mediaType,
    [mediaType]: { link: mediaUrl },
  };
  if (caption && (mediaType === 'image' || mediaType === 'video' || mediaType === 'document')) {
    payload[mediaType].caption = String(caption).slice(0, 1024);
  }
  const { data } = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  return data;
}

async function sendInteractiveMessage(userId, to, buttons, bodyText) {
  const { phoneNumberId, token } = await getCreds(userId);
  const toNum = String(to).replace(/\D/g, '');
  const url = graphUrl(phoneNumberId, 'messages');
  const list = (buttons || []).slice(0, 3).map((b, i) => ({
    type: 'reply',
    reply: { id: `btn_${i}`, title: String(b.title || b.label || b).slice(0, 20) },
  }));
  const { data } = await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      to: toNum,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: String(bodyText).slice(0, 1024) },
        action: { buttons: list },
      },
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return data;
}

async function markMessageRead(userId, messageId) {
  const { phoneNumberId, token } = await getCreds(userId);
  const url = graphUrl(phoneNumberId, 'messages');
  const { data } = await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return data;
}

module.exports = {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveMessage,
  markMessageRead,
  getCreds,
};
