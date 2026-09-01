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
    subject: 'Welcome to WhatsApp Marketing SaaS - Registration Pending',
    text: `Hi ${name},\n\nYour registration has been successfully received.\n\nYour account is currently Pending Approval from the Reseller Agency / Admin. You will receive another email once your account has been approved.\n`,
  });
}

async function sendApprovalEmail(to, name, loginUrl = 'https://w-a-frontend.vercel.app/login') {
  const transport = getTransporter();
  if (!transport) return;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@localhost';
  await transport.sendMail({
    from,
    to,
    subject: 'Account Approved - WhatsApp Marketing SaaS',
    text: `Hi ${name},\n\nCongratulations! Your account has been approved by the Admin.\n\nYou can now log in to the dashboard using your credentials to connect WhatsApp and start sending campaigns.\n\nLogin here: ${loginUrl}\n`,
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

module.exports = { sendWelcomeEmail, sendApprovalEmail, sendPasswordResetEmail, getTransporter };
