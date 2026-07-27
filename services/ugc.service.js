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
    const sessionId = `wa_${agentId}_${cleanPhone}`;
    const deviceId = `${agentId}_${cleanPhone}`;
    console.log(`[UGC AI Service] Querying Agent ID: "${agentId}" | Phone: "${cleanPhone}" | Session: "${sessionId}" | Question: "${question}"`);

    const response = await client.post(`/api/agents/${agentId}/public-ask`, {
      question,
      session_id: sessionId,
      device_id: deviceId,
      device_name: 'WhatsApp Client',
    });

    const answer = response.data?.answer || '';
    console.log(`[UGC AI Service] Agent "${agentId}" Answer: "${answer}"`);
    return answer;
  } catch (error) {
    console.error(`[UGC AI Service] Error querying external agent ${agentId}:`, error.response?.data || error.message);
    throw new Error(error.response?.data?.message || error.message || 'External agent ask failed');
  }
}

module.exports = {
  askAgent,
};
