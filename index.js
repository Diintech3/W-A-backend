require('dotenv').config({ override: true });
const http = require('http');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { validateEnv } = require('./config/env');
const connectDB = require('./config/db');
const { errorHandler, notFound } = require('./middleware/error.middleware');
const { initSocket } = require('./services/socket.service');
const { initScheduler } = require('./services/scheduler.service');
const { info, error } = require('./utils/logger');

const authRoutes = require('./routes/auth.routes');
const contactRoutes = require('./routes/contact.routes');
const campaignRoutes = require('./routes/campaign.routes');
const messageRoutes = require('./routes/message.routes');
const templateRoutes = require('./routes/template.routes');
const botRoutes = require('./routes/bot.routes');
const inboxRoutes = require('./routes/inbox.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const webhookRoutes = require('./routes/webhook.routes');
const superadminRoutes = require('./routes/superadmin.routes');
const adminRoutes = require('./routes/admin.routes');
const { protect } = require('./middleware/auth.middleware');
const authController = require('./controllers/auth.controller');

const app = express();
const server = http.createServer(app);

initSocket(server);

app.use(
  cors({
    origin: (origin, callback) => {
      // Dynamic CORS: Allow the origin so that the request can proceed to the API Key middleware
      // We reflect the origin back to allow credentials (cookies) to work for authorized clients
      callback(null, origin || true);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Global API Key Security Middleware
app.use('/api', async (req, res, next) => {
  // Allow preflight requests
  if (req.method === 'OPTIONS') return next();
  
  // Exclude webhooks (called by Meta/WhatsApp)
  if (req.path.startsWith('/webhook')) return next();
  
  // Exclude health check
  if (req.path.startsWith('/health')) return next();

  // Exclude API Sharing Login (used by external apps to get initial token)
  if (req.path === '/auth/api-sharing-login') return next();

  const providedKey = req.headers['x-api-key'];

  // 1. Check if it's the master internal key (used by the core W-A-frontend SaaS)
  if (providedKey === (process.env.VALID_API_KEYS || 'kasana-ai-super-secret-key-2026')) {
    return next();
  }

  // 2. Check if an API key is provided at all
  if (!providedKey) {
    return res.status(403).json({ success: false, message: 'Forbidden: Missing API Key' });
  }

  // 3. Dynamic Database Check for external clients (API Sharing)
  try {
    const User = require('./models/User');
    const userExists = await User.exists({ 
      'apiSharing.apiSharingKey': providedKey, 
      'apiSharing.isEnabled': true 
    });

    if (userExists) {
      return next();
    } else {
      return res.status(403).json({ success: false, message: 'Forbidden: Invalid API Sharing Key' });
    }
  } catch (err) {
    console.error('API Key DB Error:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

app.use('/api/auth', authRoutes);
app.post('/api/whatsapp/connect', protect, authController.connectWhatsApp);
app.post('/api/whatsapp/agent', protect, authController.saveAIAgentId);
app.get('/api/whatsapp/agent', protect, authController.getAIAgentId);
app.use('/api/contacts', contactRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { ok: true }, message: 'OK' });
});

app.use(notFound);
app.use(errorHandler);

const PORT = 5005;

async function syncSuperAdmin() {
  try {
    require('dotenv').config({ override: true });
    const email = (process.env.SUPER_ADMIN_EMAIL || process.env.SUPERADMIN_EMAIL || 'superadmin@gmail.com').toLowerCase().trim();
    const password = process.env.SUPER_ADMIN_PASSWORD || process.env.SUPERADMIN_PASSWORD || 'vijaywiz@123';
    const name = process.env.SUPER_ADMIN_NAME || process.env.SUPERADMIN_NAME || 'Vijay Wiz';

    const User = require('./models/User');
    let user = await User.findOne({ role: 'superadmin' }).select('+password');
    if (!user) {
      user = await User.findOne({ email }).select('+password');
    }
    if (!user) {
      user = new User({
        name,
        email,
        password,
        role: 'superadmin',
        plan: 'enterprise',
        isVerified: true
      });
      await user.save();
      info(`👑 Created Super Admin from .env: ${email}`);
    } else {
      let changed = false;
      if (user.email !== email) { user.email = email; changed = true; }
      if (user.name !== name) { user.name = name; changed = true; }
      if (!(await user.comparePassword(password))) { user.password = password; changed = true; }
      if (user.role !== 'superadmin') { user.role = 'superadmin'; changed = true; }
      if (changed) {
        await user.save();
        info(`👑 Synchronized Super Admin from .env: ${email}`);
      }
    }
  } catch (err) {
    error('Error syncing Super Admin from .env:', { reason: err.message });
  }
}

async function bootstrap() {
  try {
    validateEnv();
    await connectDB();
    await syncSuperAdmin();
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        error(`Port ${PORT} already in use. Kill the process and retry.`);
        process.exit(1);
      } else throw e;
    });
    server.listen(PORT, () => {
      info(`Server is running on port ${PORT}`);
      initScheduler();
    });
  } catch (e) {
    error('Fatal startup error', { reason: e.message });
    process.exit(1);
  }
}

bootstrap();
