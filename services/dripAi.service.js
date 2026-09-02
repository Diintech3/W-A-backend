const axios = require('axios');
const Template = require('../models/Template');
const User = require('../models/User');

function getApiKey() {
  return process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '';
}

/**
 * Generate structured Drip Campaign steps using Gemini AI
 */
async function generateDripStrategy({ goal, durationDays = 30, audienceSize = 100, userId, language = 'en' }) {
  const apiKey = getApiKey();
  const duration = parseInt(durationDays, 10) || 30;

  // Fallback heuristic generator if no API key is set
  if (!apiKey) {
    return generateFallbackStrategy(goal, duration, language);
  }

  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `You are an elite WhatsApp Drip Marketing Strategist for Indian real estate, political campaigns, local services, and NGOs.
Generate a structured, high-converting day-by-day WhatsApp Drip Campaign sequence based on the user's objective.

Campaign Goal: "${goal}"
Duration: ${duration} days
Language: ${language}
Target Audience Size: ${audienceSize}

CRITICAL RULES:
1. Category must ONLY be either "UTILITY" (for confirmations, receipts, reminders, transactional follow-ups) or "MARKETING" (for promotions, offers, discounts, awareness, invitations). NEVER use AUTHENTICATION.
2. "dayOffset" must be relative to the campaign start (e.g. Day 1, Day 4, Day 8, Day 15, Day 25) fitting comfortably within the ${duration}-day timeframe.
3. Message text MUST include variable placeholders like {{1}} for Name, {{2}} for relevant details if applicable.
4. Keep the copy punchy, engaging, friendly, and compliant with Meta WhatsApp Business policies.
5. Provide between 3 to 6 steps depending on the duration.

Respond ONLY with a valid JSON array in this EXACT format:
[
  {
    "dayOffset": 1,
    "suggestedName": "Welcome & Initial Introduction",
    "message": "Hello {{1}}, thank you for your interest in our project! We are thrilled to connect with you.",
    "suggestedCategory": "UTILITY",
    "mediaType": "text",
    "notes": "Initial welcome touchpoint",
    "variableMapping": [
      { "position": 1, "source": "contact.name", "fallback": "Customer" }
    ]
  },
  {
    "dayOffset": 4,
    "suggestedName": "Brochure & Key Highlights",
    "message": "Hi {{1}}, here are the exclusive highlights and floor plans for your review. Take a look at the attached details!",
    "suggestedCategory": "MARKETING",
    "mediaType": "document",
    "notes": "Share brochure and project details",
    "variableMapping": [
      { "position": 1, "source": "contact.name", "fallback": "Valued Guest" }
    ]
  }
]`;

  try {
    const payload = {
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json'
      }
    };

    const response = await axios.post(url, payload, { timeout: 25000 });
    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Empty AI response');
    }

    const steps = JSON.parse(text.trim());
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error('Invalid steps array format from AI');
    }

    return validateAndNormalizeSteps(steps, duration);
  } catch (err) {
    console.warn('[Drip AI Service] AI generation failed, using structured fallback:', err.message);
    return generateFallbackStrategy(goal, duration, language);
  }
}

function validateAndNormalizeSteps(rawSteps, duration) {
  return rawSteps.map((step, idx) => {
    const rawOffset = parseInt(step.dayOffset, 10);
    const dayOffset = isNaN(rawOffset) || rawOffset < 1 ? (idx * 5) + 1 : Math.min(rawOffset, duration);
    const category = ['UTILITY', 'MARKETING'].includes(step.suggestedCategory?.toUpperCase())
      ? step.suggestedCategory.toUpperCase()
      : (idx === 0 ? 'UTILITY' : 'MARKETING');
    const mediaType = ['text', 'image', 'video', 'document'].includes(step.mediaType?.toLowerCase())
      ? step.mediaType.toLowerCase()
      : 'text';

    return {
      order: idx + 1,
      dayOffset,
      suggestedName: step.suggestedName || `Step ${idx + 1} - Day ${dayOffset}`,
      message: step.message || `Hello {{1}}, here is an update regarding our campaign.`,
      suggestedCategory: category,
      mediaType,
      notes: step.notes || '',
      variableMapping: Array.isArray(step.variableMapping) && step.variableMapping.length > 0
        ? step.variableMapping.map((v, vIdx) => ({
            position: v.position || vIdx + 1,
            source: v.source || 'contact.name',
            fallback: v.fallback || 'Valued Contact',
          }))
        : [{ position: 1, source: 'contact.name', fallback: 'Friend' }],
    };
  });
}

function generateFallbackStrategy(goal, duration, language) {
  const goalLower = String(goal || '').toLowerCase();
  const stepMatch = goalLower.match(/(\d+)\s*(?:step|steps)/);
  const requestedSteps = stepMatch ? parseInt(stepMatch[1], 10) : (goalLower.includes('visit') || goalLower.includes('asha') ? 7 : (duration <= 7 ? 3 : duration <= 15 ? 4 : 5));

  if (requestedSteps >= 7 || goalLower.includes('visit') || goalLower.includes('asha') || goalLower.includes('realty')) {
    const defaultOffsets = [1, 2, 3, 4, 5, 6, 7];
    return [
      {
        order: 1,
        dayOffset: 1,
        offsetValue: 1,
        offsetUnit: 'days',
        suggestedName: 'Asha Realty Welcome & Layout',
        message: 'Hello {{1}}, welcome to Asha Realty! 🏡 Attached is our master layout and project brochure. Would you like to schedule a free VIP site visit this weekend?',
        suggestedCategory: 'MARKETING',
        mediaType: 'image',
        mediaUrl: 'https://placehold.co/600x350/064e3b/ffffff?text=Asha+Realty+Master+Layout',
        notes: 'Welcome touchpoint & layout share',
        buttons: [
          { type: 'QUICK_REPLY', text: '📅 Book Site Visit' },
          { type: 'QUICK_REPLY', text: '📍 Send Location' },
          { type: 'PHONE_NUMBER', text: 'Call Us', phoneNumber: '+919876543210' },
        ],
        variableMapping: [{ position: 1, source: 'contact.name', fallback: 'Friend' }],
      },
      {
        order: 2,
        dayOffset: 2,
        offsetValue: 2,
        offsetUnit: 'days',
        suggestedName: 'Virtual 3D Amenities Tour',
        message: 'Hi {{1}}, experience luxury living at Asha Realty with 70% green landscaping, modern clubhouse, swimming pool, and 24x7 security. Get the detailed price sheet today!',
        suggestedCategory: 'MARKETING',
        mediaType: 'image',
        mediaUrl: 'https://placehold.co/600x350/064e3b/ffffff?text=Clubhouse+and+Amenities',
        notes: 'Virtual tour & amenities showcase',
        buttons: [
          { type: 'QUICK_REPLY', text: '💰 Get Price Sheet' },
          { type: 'PHONE_NUMBER', text: 'Call Sales', phoneNumber: '+919876543210' },
        ],
        variableMapping: [{ position: 1, source: 'contact.name', fallback: 'Valued Contact' }],
      },
      {
        order: 3,
        dayOffset: 3,
        offsetValue: 3,
        offsetUnit: 'days',
        suggestedName: 'Location & Highway Connectivity',
        message: 'Dear {{1}}, location is everything! Asha Realty projects are just 5 mins from the expressway and upcoming metro station. Check our location map!',
        suggestedCategory: 'MARKETING',
        mediaType: 'image',
        mediaUrl: 'https://placehold.co/600x350/064e3b/ffffff?text=Location+and+Expressway+Map',
        notes: 'Connectivity & expressway advantage',
        buttons: [
          { type: 'QUICK_REPLY', text: '🗺️ View Route Map' },
          { type: 'QUICK_REPLY', text: '💬 Chat on WhatsApp' },
        ],
        variableMapping: [{ position: 1, source: 'contact.name', fallback: 'Customer' }],
      },
      {
        order: 4,
        dayOffset: 4,
        offsetValue: 4,
        offsetUnit: 'days',
        suggestedName: 'Trust & RERA Approvals',
        message: 'Namaste {{1}}, 100% peace of mind! All Asha Realty projects are RERA registered with leading bank loan approvals. Over 500+ happy homeowners trust us.',
        suggestedCategory: 'MARKETING',
        mediaType: 'image',
        mediaUrl: 'https://placehold.co/600x350/064e3b/ffffff?text=RERA+Approved+Legal+Docs',
        notes: 'Legal verification & customer trust',
        buttons: [
          { type: 'QUICK_REPLY', text: '📜 View RERA Docs' },
          { type: 'PHONE_NUMBER', text: 'Speak with Legal', phoneNumber: '+919876543210' },
        ],
        variableMapping: [{ position: 1, source: 'contact.name', fallback: 'Friend' }],
      },
      {
        order: 5,
        dayOffset: 5,
        offsetValue: 5,
        offsetUnit: 'days',
        suggestedName: 'Site Visit Special Offer',
        message: 'Special Visitor Perk for {{1}}! 🎉 Get an instant ₹2 Lakh discount voucher + free modular kitchen valid exclusively upon your physical site visit this week.',
        suggestedCategory: 'MARKETING',
        mediaType: 'image',
        mediaUrl: 'https://placehold.co/600x350/064e3b/ffffff?text=Special+Discount+Voucher',
        notes: 'Incentive for taking site visit',
        buttons: [
          { type: 'QUICK_REPLY', text: '🎁 Lock Visit Offer' },
          { type: 'PHONE_NUMBER', text: 'Claim Voucher', phoneNumber: '+919876543210' },
        ],
        variableMapping: [{ position: 1, source: 'contact.name', fallback: 'Valued Guest' }],
      },
      {
        order: 6,
        dayOffset: 6,
        offsetValue: 6,
        offsetUnit: 'days',
        suggestedName: 'Free VIP Cab Service',
        message: 'Hello {{1}}, we are arranging a complimentary AC cab pick-and-drop from your doorstep for your site visit this weekend. Confirm your cab pass now!',
        suggestedCategory: 'MARKETING',
        mediaType: 'image',
        mediaUrl: 'https://placehold.co/600x350/064e3b/ffffff?text=Complimentary+AC+Cab+Pass',
        notes: 'Free pick-and-drop cab pass',
        buttons: [
          { type: 'QUICK_REPLY', text: '🚗 Book Free Cab' },
          { type: 'QUICK_REPLY', text: '📅 Pick Sunday' },
        ],
        variableMapping: [{ position: 1, source: 'contact.name', fallback: 'Friend' }],
      },
      {
        order: 7,
        dayOffset: 7,
        offsetValue: 7,
        offsetUnit: 'days',
        suggestedName: 'Urgent Weekend Slot Reminder',
        message: 'Final Reminder {{1}} ⏳ Only 3 VIP visitor slots left for this Saturday & Sunday. Confirm your preferred visit timing before slots fill up!',
        suggestedCategory: 'MARKETING',
        mediaType: 'image',
        mediaUrl: 'https://placehold.co/600x350/064e3b/ffffff?text=Final+Weekend+Passes+Left',
        notes: 'Urgency & final weekend confirmation',
        buttons: [
          { type: 'QUICK_REPLY', text: '✅ Confirm My Slot' },
          { type: 'QUICK_REPLY', text: '⏰ Reschedule' },
        ],
        variableMapping: [{ position: 1, source: 'contact.name', fallback: 'Valued Contact' }],
      },
    ];
  }

  const stepsCount = Math.max(3, requestedSteps);
  const offsets = [1, 3, 6, 10, 15, 20, 25];

  return offsets.slice(0, stepsCount).map((dayOffset, idx) => ({
    order: idx + 1,
    dayOffset,
    offsetValue: dayOffset,
    offsetUnit: 'days',
    suggestedName: `Asha Realty Touchpoint ${idx + 1}`,
    message: idx === 0
      ? `Hello {{1}}, thank you for connecting with Asha Realty regarding our prime properties. We are excited to share full details with you!`
      : idx === 1
      ? `Hi {{1}}, here is our latest brochure, master floor plans, and pricing sheet for your review.`
      : idx === 2
      ? `Namaste {{1}}, see our construction progress and world-class clubhouse amenities. When can we schedule your VIP site visit?`
      : `Hi {{1}}, limited corner plots remain available. Let us know if you would like to book your visit this weekend!`,
    suggestedCategory: 'MARKETING',
    mediaType: 'image',
    mediaUrl: 'https://placehold.co/600x350/064e3b/ffffff?text=Asha+Realty+Touchpoint',
    notes: `Automated sequence step ${idx + 1} for day ${dayOffset}`,
    buttons: [
      { type: 'QUICK_REPLY', text: '📅 Book Site Visit' },
      { type: 'PHONE_NUMBER', text: 'Call Us', phoneNumber: '+919876543210' },
    ],
    variableMapping: [{ position: 1, source: 'contact.name', fallback: 'Valued Contact' }],
  }));
}

/**
 * Process AI generated steps: create dedicated custom draft templates for review
 */
async function processGeneratedStepsWithTemplates(userId, generatedSteps) {
  const user = await User.findById(userId);
  const parentAdminId = user?.parentAdmin || userId;

  const stepsWithTemplates = [];

  for (const step of generatedSteps) {
    const cleanName = `asha_${step.suggestedName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}_${Date.now().toString().slice(-4)}`;
    
    // Always create a dedicated draft template so the client can review and edit before sending to Meta
    const newTemplate = await Template.create({
      userId: parentAdminId,
      assignedTo: userId,
      createdByAdmin: null,
      name: step.suggestedName,
      whatsappTemplateName: cleanName,
      languageCode: 'en',
      category: step.suggestedCategory || 'MARKETING',
      bodyPreview: step.message,
      headerType: (step.mediaType || 'image').toUpperCase() === 'IMAGE' ? 'IMAGE' : 'TEXT',
      mediaUrl: step.mediaUrl || 'https://placehold.co/600x350/064e3b/ffffff?text=Asha+Realty+Graphic',
      buttons: Array.isArray(step.buttons) ? step.buttons : [
        { type: 'QUICK_REPLY', text: '📅 Book Site Visit' },
        { type: 'PHONE_NUMBER', text: 'Call Sales', phoneNumber: '+919876543210' }
      ],
      metaStatus: 'DRAFT',
      sampleParams: (step.variableMapping || []).map((v) => ({
        key: String(v.position),
        value: v.fallback || 'Rahul',
      })),
    });

    stepsWithTemplates.push({
      ...step,
      templateId: newTemplate._id,
      templateName: newTemplate.name,
      metaStatus: 'DRAFT',
      isDraftCreated: true,
      templateDetails: newTemplate,
    });
  }

  return {
    steps: stepsWithTemplates,
    allApproved: false,
    suggestedStatus: 'draft',
  };
}

module.exports = {
  generateDripStrategy,
  processGeneratedStepsWithTemplates,
};
