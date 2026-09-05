const axios = require('axios');
const User = require('../models/User');

const apiVersion = () => process.env.WHATSAPP_API_VERSION || 'v19.0';

async function getCreds(userId) {
  const user = await User.findById(userId).select('+whatsappAccessToken');
  
  let phoneNumberId = user?.whatsappPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
  let token = user?.whatsappAccessToken || process.env.WHATSAPP_ACCESS_TOKEN;

  if ((!phoneNumberId || !token) && user?.parentAdmin) {
    const parent = await User.findById(user.parentAdmin).select('+whatsappAccessToken');
    if (!phoneNumberId) phoneNumberId = parent?.whatsappPhoneNumberId;
    if (!token) token = parent?.whatsappAccessToken;
  }

  phoneNumberId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
  token = token || process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !token) {
    const err = new Error('WhatsApp not connected. Add Phone Number ID and Access Token.');
    err.statusCode = 400;
    throw err;
  }
  return {
    phoneNumberId,
    token,
  };
}

function normalizePhone(to) {
  if (!to) return '';
  let num = String(to).replace(/\D/g, '');
  if (num.length === 10 && /^[6-9]/.test(num)) {
    num = '91' + num;
  } else if (num.length === 11 && num.startsWith('0') && /^[6-9]/.test(num.slice(1))) {
    num = '91' + num.slice(1);
  }
  return num;
}

function graphUrl(phoneNumberId, path = '') {
  const base = `https://graph.facebook.com/${apiVersion()}/${phoneNumberId}`;
  return path ? `${base}/${path}` : base;
}

async function sendTextMessage(userId, to, message) {
  const { phoneNumberId, token } = await getCreds(userId);
  const toNum = normalizePhone(to);
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

function isValidHttpUrl(string) {
  if (!string || typeof string !== 'string') return false;
  try {
    const url = new URL(string.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

const DEFAULT_FALLBACK_IMAGE = 'https://pub-922d0b8e92144ec8adc99d837e581709.r2.dev/templates/1788359049295-0a037ab5553e45de7a3da761.jpg';

function buildTemplateComponents(params) {
  const components = [];

  // Check if params is an object containing header or body keys
  if (params && !Array.isArray(params) && (params.header || params.body)) {
    if (params.header && params.header.length) {
      components.push({
        type: 'header',
        parameters: params.header.map(val => {
          let str = String(val).trim();
          if (str.includes('r2.cloudflarestorage.com')) {
            const publicBase = (process.env.R2_PUBLIC_URL || 'https://pub-922d0b8e92144ec8adc99d837e581709.r2.dev').replace(/\/$/, '');
            const pathParts = str.split('/templates/');
            if (pathParts.length > 1) {
              str = `${publicBase}/templates/${pathParts[1]}`;
            }
          }
          const isImg = /^https?:\/\/.+/i.test(str);
          if (isImg) {
            const validUrl = (isValidHttpUrl(str) && !str.includes('r2.cloudflarestorage.com') && !str.startsWith('blob:')) ? str : DEFAULT_FALLBACK_IMAGE;
            return { type: 'image', image: { link: validUrl } };
          }
          return { type: 'text', text: str };
        })
      });
    }
    if (params.body && params.body.length) {
      components.push({
        type: 'body',
        parameters: params.body.map(val => ({
          type: 'text',
          text: String(val)
        }))
      });
    }
    return components;
  }

  // Fallback to array parameters (Old behavior)
  if (!params || !params.length) {
    return [];
  }

  const headerParams = [];
  const bodyParams = [];

  for (const p of params) {
    let val = typeof p === 'string' ? p : String(p.text ?? p.value ?? p.parameter_name ?? '');
    
    // Check if the value is an image link
    const isImage = (p.parameter_name === 'header_image' || p.key === 'header_image' || p.type === 'image') ||
                    /^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(val) || 
                    (val.startsWith('http') && (val.includes('r2.cloudflarestorage.com') || val.includes('r2.dev') || val.includes('cloudinary')));

    if (isImage) {
      let imgLink = String(val).trim();
      if (imgLink.includes('r2.cloudflarestorage.com')) {
        const publicBase = (process.env.R2_PUBLIC_URL || 'https://pub-922d0b8e92144ec8adc99d837e581709.r2.dev').replace(/\/$/, '');
        const pathParts = imgLink.split('/templates/');
        if (pathParts.length > 1) {
          imgLink = `${publicBase}/templates/${pathParts[1]}`;
        }
      }
      if (!isValidHttpUrl(imgLink) || imgLink.startsWith('blob:') || imgLink.includes('r2.cloudflarestorage.com')) {
        imgLink = DEFAULT_FALLBACK_IMAGE;
      }
      headerParams.push({
        type: 'image',
        image: { link: imgLink }
      });
    } else {
      bodyParams.push({
        type: 'text',
        text: val
      });
    }
  }

  if (headerParams.length > 0) {
    components.push({
      type: 'header',
      parameters: headerParams
    });
  }
  
  if (bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyParams
    });
  }

  return components;
}

async function sendTemplateMessage(userId, to, templateName, languageCode, params) {
  const { phoneNumberId, token } = await getCreds(userId);
  const toNum = normalizePhone(to);
  const url = graphUrl(phoneNumberId, 'messages');
  const bodyParams = buildTemplateComponents(params);
  const templatePayload = {
    name: templateName,
    language: { code: languageCode || 'en' },
  };
  const validComponents = (bodyParams || []).filter(c => c && c.parameters && c.parameters.length > 0);
  if (validComponents.length > 0) {
    templatePayload.components = validComponents;
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
  const toNum = normalizePhone(to);
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
  const toNum = normalizePhone(to);
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
 * Upload media binary to Meta Graph API Resumable Upload Session to get official header_handle
 */
async function getMetaMediaHandle(token, mediaUrl, defaultMime = 'image/jpeg') {
  if (!mediaUrl) return null;
  try {
    let buffer;
    let mimeType = defaultMime;

    if (mediaUrl.startsWith('data:')) {
      const parts = mediaUrl.split(',');
      const match = parts[0].match(/:(.*?);/);
      if (match) mimeType = match[1];
      buffer = Buffer.from(parts[1], 'base64');
    } else {
      try {
        let fetchUrl = String(mediaUrl).trim();
        if (fetchUrl.includes('r2.cloudflarestorage.com')) {
          const publicBase = (process.env.R2_PUBLIC_URL || 'https://pub-922d0b8e92144ec8adc99d837e581709.r2.dev').replace(/\/$/, '');
          const pathParts = fetchUrl.split('/templates/');
          if (pathParts.length > 1) {
            fetchUrl = `${publicBase}/templates/${pathParts[1]}`;
          } else {
            const anyParts = fetchUrl.split('/yovoai/');
            if (anyParts.length > 1) fetchUrl = `${publicBase}/${anyParts[1]}`;
          }
        }
        const resp = await axios.get(fetchUrl, { responseType: 'arraybuffer', timeout: 10000 });
        buffer = Buffer.from(resp.data);
        if (resp.headers['content-type']) {
          mimeType = resp.headers['content-type'].split(';')[0];
        }
      } catch (dlErr) {
        console.warn('[WhatsApp Service] Direct mediaUrl download failed, using sample jpeg fallback:', dlErr.message);
        // 1x1 valid sample jpeg
        buffer = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
        mimeType = 'image/jpeg';
      }
    }

    if (!buffer || buffer.length === 0) {
      buffer = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
      mimeType = 'image/jpeg';
    }

    // 1. Get Meta App ID from token debug
    const debugRes = await axios.get(`https://graph.facebook.com/${apiVersion()}/debug_token?input_token=${token}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    const appId = debugRes.data?.data?.app_id;
    if (!appId) throw new Error('Could not resolve Meta App ID from access token');

    // 2. Start upload session
    const sessionRes = await axios.post(`https://graph.facebook.com/${apiVersion()}/${appId}/uploads`, null, {
      params: {
        file_length: buffer.length,
        file_type: mimeType,
        access_token: token,
      },
      timeout: 15000,
    });
    const uploadSessionId = sessionRes.data?.id;
    if (!uploadSessionId) throw new Error('Failed to create upload session on Meta');

    // 3. Upload file binary to session
    const uploadRes = await axios.post(`https://graph.facebook.com/${apiVersion()}/${uploadSessionId}`, buffer, {
      headers: {
        Authorization: `OAuth ${token}`,
        file_offset: 0,
        'Content-Type': 'application/octet-stream',
      },
      timeout: 30000,
    });

    return uploadRes.data?.h || null;
  } catch (err) {
    console.error('[WhatsApp Service] Meta Resumable Upload failed:', err.response?.data || err.message);
    return null;
  }
}

function cleanButtonText(txt, fallback = 'Action') {
  if (!txt) return fallback;
  let clean = txt
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) clean = fallback;
  return clean.slice(0, 25);
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

  const {
    name,
    category,
    language,
    bodyText,
    headerType,
    headerText,
    footerText,
    mediaUrl,
    mediaHandle,
    buttons,
    headerVariables,
    bodyVariables,
  } = templateData;

  // Components build karo
  const components = [];

  // 1. Header Component
  const effectiveHeaderType = (headerType || (headerText ? 'TEXT' : 'NONE')).toUpperCase();
  if (effectiveHeaderType === 'TEXT' && headerText && headerText.trim()) {
    const headerComponent = { type: 'HEADER', format: 'TEXT', text: headerText.trim() };
    if (headerVariables && headerVariables.length > 0) {
      headerComponent.example = { header_text: headerVariables };
    }
    components.push(headerComponent);
  } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(effectiveHeaderType)) {
    const headerComponent = { type: 'HEADER', format: effectiveHeaderType };
    let handle = mediaHandle;
    if (!handle && mediaUrl) {
      handle = await getMetaMediaHandle(token, mediaUrl, effectiveHeaderType === 'VIDEO' ? 'video/mp4' : 'image/jpeg');
    }
    if (handle) {
      headerComponent.example = { header_handle: [handle] };
    }
    components.push(headerComponent);
  }

  // 2. Body component (required)
  const bodyComponent = { type: 'BODY', text: bodyText };
  const varMatches = (bodyText || '').match(/\{\{(\d+)\}\}/g) || [];
  const requiredVarCount = new Set(varMatches).size;

  if (requiredVarCount > 0) {
    let vars = Array.isArray(bodyVariables) && bodyVariables.length >= requiredVarCount
      ? bodyVariables
      : Array.from({ length: requiredVarCount }, (_, i) => `Sample ${i + 1}`);
    bodyComponent.example = {
      body_text: [vars],
    };
  }
  components.push(bodyComponent);

  // 3. Footer component (optional)
  if (footerText && footerText.trim()) {
    components.push({ type: 'FOOTER', text: footerText.trim() });
  }

  // 4. Buttons component (optional & sanitized for Meta)
  if (Array.isArray(buttons) && buttons.length > 0) {
    const hasCta = buttons.some((b) => b && (b.type === 'PHONE_NUMBER' || b.type === 'URL'));
    let validButtons = [];

    if (hasCta) {
      // Meta rules: max 1 phone + max 2 URLs for CTA
      const phoneBtn = buttons.find((b) => b && b.type === 'PHONE_NUMBER');
      const urlBtns = buttons.filter((b) => b && b.type === 'URL').slice(0, 2);

      if (phoneBtn) {
        let phone = (phoneBtn.phoneNumber || '+919876543210').trim().replace(/[^0-9+]/g, '');
        if (!phone.startsWith('+')) phone = `+${phone}`;
        validButtons.push({
          type: 'PHONE_NUMBER',
          text: cleanButtonText(phoneBtn.text, 'Call Us'),
          phone_number: phone,
        });
      }

      urlBtns.forEach((u) => {
        let url = (u.url || 'https://asharealty.com').trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = `https://${url}`;
        }
        validButtons.push({
          type: 'URL',
          text: cleanButtonText(u.text, 'Visit Website'),
          url,
        });
      });
    } else {
      // Quick Reply buttons (up to 3 or 10)
      validButtons = buttons
        .filter((b) => b && b.text && b.text.trim())
        .slice(0, 3)
        .map((b, i) => ({
          type: 'QUICK_REPLY',
          text: cleanButtonText(b.text, `Option ${i + 1}`),
        }));
    }

    if (validButtons.length > 0) {
      components.push({
        type: 'BUTTONS',
        buttons: validButtons,
      });
    }
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

/**
 * Download media binary from WhatsApp Graph API using media ID
 */
async function downloadMedia(userId, mediaId) {
  const { token } = await getCreds(userId);
  const version = apiVersion();

  // 1. Fetch media URL from Meta Graph API
  const metaUrl = `https://graph.facebook.com/${version}/${mediaId}`;
  const response = await axios.get(metaUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const downloadUrl = response?.data?.url;
  const mimeType = response?.data?.mime_type;
  if (!downloadUrl) {
    throw new Error('Failed to retrieve media download URL from WhatsApp API.');
  }

  // 2. Fetch the actual media binary content
  const mediaResponse = await axios.get(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'arraybuffer',
  });

  return {
    buffer: Buffer.from(mediaResponse.data),
    mimeType,
  };
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
  downloadMedia,
};
