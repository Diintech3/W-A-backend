const nodemailer = require('nodemailer');

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });
}

async function sendWelcomeEmail(to, name) {
  const transport = getTransporter();
  if (!transport) return;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@localhost';
  await transport.sendMail({
    from,
    to,
    subject: 'Welcome to WhatsApp Marketing SaaS',
    text: `Hi ${name},\n\nYour account is ready. Connect WhatsApp in the dashboard to start sending campaigns.\n`,
  });
}

async function sendPasswordResetEmail(to, resetLink) {
  const transport = getTransporter();
  if (!transport) return;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@localhost';
  await transport.sendMail({
    from,
    to,
    subject: 'Password reset',
    text: `Reset your password: ${resetLink}\n`,
  });
}

module.exports = { sendWelcomeEmail, sendPasswordResetEmail, getTransporter };
