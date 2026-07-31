const axios = require('axios');
async function test() {
  try {
    const res = await axios.post('http://localhost:5005/api/auth/login', {
      email: 'vijaywiz@gmail.com',
      password: 'vijaywiz@123',
      expectedRole: 'superadmin'
    }, {
      headers: {
        'x-api-key': 'masterkey_2026'
      }
    });
    console.log("Success:", res.data);
  } catch (err) {
    console.log("Error:", err.response ? err.response.data : err.message);
  }
}
test();
