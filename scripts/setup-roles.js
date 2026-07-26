require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const SUPERADMIN_EMAIL = 'vijaywiz@gmail.com';
const ADMIN_EMAIL = 'diintechteam12@gmail.com';
const CLIENT_EMAILS = [
  'anilkumarsingh43425@gmail.com',
  'amanpandya161@gmail.com',
  'diintechteam9@gmail.com',
  'nandu797090@gmail.com',
];

async function setupRoles() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is not defined in .env');
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB successfully.\n');

    // 1. Setup Super Admin (Sir Vijay)
    let superadmin = await User.findOne({ email: SUPERADMIN_EMAIL });
    if (!superadmin) {
      console.log(`👑 Creating Super Admin (${SUPERADMIN_EMAIL})...`);
      superadmin = new User({
        name: 'Vijay Wiz',
        email: SUPERADMIN_EMAIL,
        password: 'vijaywiz@123',
        businessName: 'WHATS-AI Platform Owner',
        phone: '919999999999',
        plan: 'enterprise',
        role: 'superadmin',
        isVerified: true,
      });
      await superadmin.save();
    } else {
      console.log(`👑 Updating existing Super Admin (${SUPERADMIN_EMAIL})...`);
      superadmin.role = 'superadmin';
      superadmin.plan = 'enterprise';
      superadmin.isVerified = true;
      superadmin.password = 'vijaywiz@123';
      await superadmin.save();
    }
    console.log(`✅ Super Admin ready: ${superadmin.name} (${superadmin.email})\n`);

    // 2. Setup Admin (Ashi)
    let admin = await User.findOne({ email: ADMIN_EMAIL });
    if (!admin) {
      console.log(`🛡️ Creating Admin (${ADMIN_EMAIL})...`);
      admin = new User({
        name: 'Ashi Admin',
        email: ADMIN_EMAIL,
        password: 'admin@123',
        businessName: 'Diin Tech Agency',
        phone: '919898989898',
        plan: 'pro',
        role: 'admin',
        parentAdmin: superadmin._id,
        isVerified: true,
        adminLimits: { maxClients: 50, maxMessages: 500000 },
      });
      await admin.save();
    } else {
      console.log(`🛡️ Updating existing Admin (${ADMIN_EMAIL})...`);
      admin.role = 'admin';
      admin.parentAdmin = superadmin._id;
      admin.plan = 'pro';
      admin.isVerified = true;
      admin.password = 'admin@123';
      admin.adminLimits = { maxClients: 50, maxMessages: 500000 };
      await admin.save();
    }
    console.log(`✅ Admin ready: ${admin.name} (${admin.email})\n`);

    // 3. Link 4 Clients to Admin Ashi & set password
    console.log(`👤 Setting up & linking clients to Admin Ashi...`);
    let linkedCount = 0;
    for (const email of CLIENT_EMAILS) {
      let client = await User.findOne({ email });
      if (!client) {
        client = new User({
          name: email.split('@')[0],
          email: email,
          password: 'client@123',
          businessName: 'Client Business',
          phone: '919000000000',
          plan: 'pro',
          role: 'client',
          parentAdmin: admin._id,
          isVerified: true,
        });
        await client.save();
        console.log(`   ✔️ Created & linked client: ${client.name} (${client.email})`);
        linkedCount++;
      } else {
        client.role = 'client';
        client.parentAdmin = admin._id;
        client.password = 'client@123';
        await client.save();
        console.log(`   ✔️ Updated client: ${client.name} (${client.email})`);
        linkedCount++;
      }
    }
    console.log(`\n✅ Linked ${linkedCount} clients successfully.\n`);

    console.log('====================================================');
    console.log('       🔐 ALL PANEL CREDENTIALS SUMMARY 🔐          ');
    console.log('====================================================');
    console.log('1. SUPER ADMIN PANEL');
    console.log(`   Email   : ${SUPERADMIN_EMAIL}`);
    console.log('   Password: vijaywiz@123');
    console.log('----------------------------------------------------');
    console.log('2. ADMIN PANEL (Reseller/Agency)');
    console.log(`   Email   : ${ADMIN_EMAIL}`);
    console.log('   Password: admin@123');
    console.log('----------------------------------------------------');
    console.log('3. CLIENT PANEL (Marketing Dashboard)');
    console.log(`   Email   : ${CLIENT_EMAILS[0]}`);
    console.log('   Password: client@123');
    console.log('====================================================\n');

    process.exit(0);
  } catch (e) {
    console.error('❌ Error setting up roles & passwords:', e);
    process.exit(1);
  }
}

setupRoles();
