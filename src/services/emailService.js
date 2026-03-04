const nodemailer = require('nodemailer');
const env = require('../config/env');

const transporter = nodemailer.createTransport({
  host: env.email.host,
  port: env.email.port,
  secure: false, // TLS
  auth: {
    user: env.email.user,
    pass: env.email.pass,
  },
});

async function sendOtpEmail(toEmail, otp) {
  await transporter.sendMail({
    from: env.email.from,
    to: toEmail,
    subject: 'Your SnapVault OTP',
    text: `Your SnapVault OTP is: ${otp}\n\nThis code is valid for 10 minutes. Do not share it with anyone.`,
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: auto;">
        <h2 style="color: #1a1a2e;">SnapVault Verification</h2>
        <p>Your one-time password is:</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #4f46e5; margin: 20px 0;">
          ${otp}
        </div>
        <p style="color: #666;">Valid for <strong>10 minutes</strong>. Do not share this code with anyone.</p>
      </div>
    `,
  });
}

module.exports = { sendOtpEmail };
