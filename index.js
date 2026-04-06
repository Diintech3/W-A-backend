require('dotenv').config();
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
const { protect } = require('./middleware/auth.middleware');
const authController = require('./controllers/auth.controller');

const app = express();
const server = http.createServer(app);

initSocket(server);

app.use(
  cors({
    origin: (origin, callback) => {
      const allowed = [
        process.env.CLIENT_URL,
        'http://localhost:5173',
      ].map((u) => u?.replace(/\/$/, '')).filter(Boolean)
      if (!origin || allowed.includes(origin.replace(/\/$/, ''))) {
        callback(null, true)
      } else {
        callback(new Error('Not allowed by CORS'))
      }
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.post('/api/whatsapp/connect', protect, authController.connectWhatsApp);
app.use('/api/contacts', contactRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/webhook', webhookRoutes);

app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { ok: true }, message: 'OK' });
});

app.use(notFound);
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 5000;

async function bootstrap() {
  try {
    validateEnv();
    await connectDB();
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
