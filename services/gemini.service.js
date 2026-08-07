const axios = require('axios');

function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.warn('[Gemini Service] WARNING: GEMINI_API_KEY is not set in environment. AI features will fallback to default success values.');
  }
  return key;
}

/**
 * Moderates an image using Gemini API
 * Checks for blur, NSFW, inappropriate content
 * Returns { valid: boolean, reason: string }
 */
async function moderateImage(buffer, mimeType) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { valid: true, reason: 'Gemini API key missing, moderation skipped' };
  }

  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const payload = {
      contents: [
        {
          parts: [
            {
              text: 'Analyze the attached image. Determine if it is blurry, inappropriate (NSFW), contains violence, offensive content, or is otherwise completely unusable for a public event gallery. Respond ONLY with a valid JSON object in this exact format:\n{\n  "valid": true/false,\n  "reason": "Brief explanation in Hindi/Hinglish if valid is false, or \'Image is valid\' if true"\n}'
            },
            {
              inlineData: {
                mimeType: mimeType || 'image/jpeg',
                data: buffer.toString('base64')
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json'
      }
    };

    const response = await axios.post(url, payload, { timeout: 15000 });
    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Empty response from Gemini');
    }

    const result = JSON.parse(text.trim());
    console.log('[Gemini Moderation] Result:', result);
    return {
      valid: typeof result.valid === 'boolean' ? result.valid : true,
      reason: result.reason || 'Image is valid'
    };
  } catch (err) {
    console.error('[Gemini Moderation] Error during moderation:', err.message);
    // Fallback to true so we don't block users if API fails
    return { valid: true, reason: 'Moderation error, skipped' };
  }
}

/**
 * Checks if the face in the selfie matches any face in the event photo
 * Returns { match: boolean, confidence: number }
 */
async function matchFaces(selfieBuffer, selfieMime, photoUrl) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { match: true, confidence: 100 }; // fallback to match
  }

  try {
    // 1. Download event photo binary stream
    const photoResponse = await axios.get(photoUrl, { responseType: 'arraybuffer', timeout: 10000 });
    const photoBuffer = Buffer.from(photoResponse.data);
    const photoMime = photoResponse.headers['content-type'] || 'image/jpeg';

    const model = 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // 2. Query Gemini with both images
    const payload = {
      contents: [
        {
          parts: [
            {
              text: 'Compare the person\'s face in the first image (which is a guest\'s selfie) with the second image (which is an event photo). Determine if the guest\'s face from the first image is present in the second image. Respond ONLY with a valid JSON object in this exact format:\n{\n  "match": true/false,\n  "confidence": 0-100\n}'
            },
            {
              inlineData: {
                mimeType: selfieMime || 'image/jpeg',
                data: selfieBuffer.toString('base64')
              }
            },
            {
              inlineData: {
                mimeType: photoMime,
                data: photoBuffer.toString('base64')
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json'
      }
    };

    const response = await axios.post(url, payload, { timeout: 20000 });
    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Empty response from Gemini');
    }

    const result = JSON.parse(text.trim());
    console.log('[Gemini Face Matching] Result:', result);
    return {
      match: typeof result.match === 'boolean' ? result.match : false,
      confidence: typeof result.confidence === 'number' ? result.confidence : 0
    };
  } catch (err) {
    console.error('[Gemini Face Matching] Error matching faces:', err.message);
    return { match: false, confidence: 0 };
  }
}

module.exports = {
  moderateImage,
  matchFaces
};
