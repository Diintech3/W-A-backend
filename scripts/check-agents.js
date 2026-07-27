require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const AIAgent = require('../models/AIAgent');

async function checkMappings() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('--- CONNECTED TO MONGODB ---');

    const users = await User.find({}).select('name email role whatsappPhoneNumberId');
    const agents = await AIAgent.find({});

    console.log('\n================ USER & AI AGENT MAPPINGS ================');
    for (const u of users) {
      const agent = agents.find(a => String(a.userId) === String(u._id));
      console.log(`User: ${u.name.padEnd(20)} | Email: ${u.email.padEnd(25)} | Role: ${u.role.padEnd(10)} | PhoneID: ${(u.whatsappPhoneNumberId || 'N/A').padEnd(15)} | AgentID: ${agent ? agent.externalAgentId : 'NOT SET'}`);
    }
    console.log('==========================================================\n');

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkMappings();
