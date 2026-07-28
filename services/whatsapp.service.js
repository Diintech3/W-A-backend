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

/**
 * Meta Graph API se user ke WABA ke saare templates fetch karo
 * Returns array of template objects from Meta
 */
async function fetchMetaTemplates(userId) {
  const user = await User.findById(userId).select('+whatsappAccessToken');

  // Token: user DB se, warna .env fallback
  const token = user?.whatsappAccessToken || process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    const err = new Error('WhatsApp Access Token not configured. Please connect WhatsApp first in Settings.');
    err.statusCode = 400;
    throw err;
  }

  // WABA ID: user ke DB se, warna .env fallback
  const wabaId = user?.whatsappWabaId || process.env.WABA_ID || process.env.WHATSAPP_WABA_ID;
  if (!wabaId) {
    const err = new Error('WhatsApp Business Account ID (WABA_ID) not configured. Add it in Settings or .env file.');
    err.statusCode = 400;
    throw err;
  }

  const version = apiVersion();
  const url = `https://graph.facebook.com/${version}/${wabaId}/message_templates`;

  const { data } = await axios.get(url, {
    params: { limit: 250, fields: 'name,status,language,category,components' },
    headers: { Authorization: `Bearer ${token}` },
  });

  return data.data || [];
}

/**
 * Ek specific template name ko Meta se verify karo
 * Returns { found, status, components, language } 
 */
async function verifyMetaTemplate(userId, templateName) {
  const templates = await fetchMetaTemplates(userId);
  const match = templates.find(
    (t) => t.name.toLowerCase() === String(templateName).toLowerCase().trim()
  );
  if (!match) {
    return { found: false, status: null, components: [], language: null };
  }
  return {
    found: true,
    status: match.status, // 'APPROVED' | 'PENDING' | 'REJECTED' | 'DISABLED'
    language: match.language,
    category: match.category,
    components: match.components || [],
  };
}

/**
 * Meta WABA par directly naya template CREATE karo
 * @param {string} adminUserId - admin user ka ID (token + WABA ID ke liye)
 * @param {object} templateData - { name, category, language, bodyText, headerText, footerText, variables }
 * Returns Meta API response with template ID
 */
async function createMetaTemplate(adminUserId, templateData) {
  const user = await User.findById(adminUserId).select('+whatsappAccessToken');
  const token = user?.whatsappAccessToken || process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    const err = new Error('WhatsApp Access Token not configured.');
    err.statusCode = 400;
    throw err;
  }

  const wabaId = user?.whatsappWabaId || process.env.WABA_ID || process.env.WHATSAPP_WABA_ID;
  if (!wabaId) {
    const err = new Error('WABA_ID not configured. Add it in Settings.');
    err.statusCode = 400;
    throw err;
  }

  const { name, category, language, bodyText, headerText, footerText, headerVariables, bodyVariables } = templateData;

  // Components build karo
  const components = [];

  if (headerText && headerText.trim()) {
    const headerComponent = { type: 'HEADER', format: 'TEXT', text: headerText.trim() };
    if (headerVariables && headerVariables.length > 0) {
      headerComponent.example = { header_text: headerVariables };
    }
    components.push(headerComponent);
  }

  // Body component (required)
  const bodyComponent = { type: 'BODY', text: bodyText };
  // Agar variables hain to example add karo
  if (bodyVariables && bodyVariables.length > 0) {
    bodyComponent.example = {
      body_text: [bodyVariables],
    };
  }
  components.push(bodyComponent);

  if (footerText && footerText.trim()) {
    components.push({ type: 'FOOTER', text: footerText.trim() });
  }

  const version = apiVersion();
  const url = `https://graph.facebook.com/${version}/${wabaId}/message_templates`;

  const payload = {
    name: String(name).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
    category: category || 'MARKETING',
    language: language || 'en',
    components,
  };

  const { data } = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  return data; // { id, status } — Meta ka response
}

/**
 * Ek template ka latest Meta status refresh karo by name
 */
async function refreshTemplateStatus(adminUserId, templateName) {
  const result = await verifyMetaTemplate(adminUserId, templateName);
  return result;
}

module.exports = {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveMessage,
  markMessageRead,
  getCreds,
  fetchMetaTemplates,
  verifyMetaTemplate,
  createMetaTemplate,
  refreshTemplateStatus,
};
