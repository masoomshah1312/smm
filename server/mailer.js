const nodemailer = require('nodemailer');

function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendPasswordReset(toEmail, resetLink) {
  const transport = getTransport();
  const subject = 'Reset your password';
  const html = `
    <p>You (or someone else) requested a password reset for your account.</p>
    <p><a href="${resetLink}">Click here to set a new password</a>. This link expires in 1 hour.</p>
    <p>If you didn't request this, you can ignore this email.</p>
  `;

  if (!transport) {
    // No SMTP configured - log to console so local/dev use still works.
    console.log('--- PASSWORD RESET EMAIL (SMTP not configured, printing instead) ---');
    console.log(`To: ${toEmail}`);
    console.log(`Reset link: ${resetLink}`);
    console.log('----------------------------------------------------------------------');
    return;
  }

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject,
    html,
  });
}

module.exports = { sendPasswordReset };
