const axios = require('axios');

const UGC_AI_BASE_URL = process.env.UGC_AI_BASE_URL || 'https://vectorize.onthewifi.com';
const UGC_AI_APP_TOKEN = process.env.UGC_AI_APP_TOKEN || '';

const client = axios.create({
  baseURL: UGC_AI_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'X-App-Token': UGC_AI_APP_TOKEN,
  },
  timeout: 15000, // 15 seconds
});

/**
 * Asks the external agent a question
 * @param {string} agentId
 * @param {string} question
 * @param {string} userPhone
 * @returns {Promise<string>} answer
 */
async function askAgent(agentId, question, userPhone) {
  try {
    const cleanPhone = String(userPhone).replace(/\D/g, '');
    const response = await client.post(`/api/agents/${agentId}/public-ask`, {
      question,
      session_id: `wa_${cleanPhone}`,
      device_id: cleanPhone,
      device_name: 'WhatsApp Client',
    });

    return response.data?.answer || '';
  } catch (error) {
    console.error(`Error querying external agent ${agentId}:`, error.response?.data || error.message);
    throw new Error(error.response?.data?.message || error.message || 'External agent ask failed');
  }
}

module.exports = {
  askAgent,
};
