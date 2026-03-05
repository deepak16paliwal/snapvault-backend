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

async function sendAddedToEventEmail(toEmail, eventTitle, organizerName) {
  await transporter.sendMail({
    from: env.email.from,
    to: toEmail,
    subject: `You've been added to "${eventTitle}" on SnapVault`,
    text: `Hi,\n\n${organizerName} has added you to the event "${eventTitle}" on SnapVault.\n\nOpen the app to view photos and join the fun!\n\n— The SnapVault Team`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
        <h2 style="color: #1a1a2e;">You've been added to an event!</h2>
        <p><strong>${organizerName}</strong> has added you to the event:</p>
        <div style="background: linear-gradient(135deg, #6C63FF, #A855F7); color: white; border-radius: 12px; padding: 20px; margin: 16px 0;">
          <h3 style="margin: 0; font-size: 20px;">${eventTitle}</h3>
        </div>
        <p>Open the SnapVault app to view photos and participate.</p>
        <p style="color: #888; font-size: 12px;">— The SnapVault Team</p>
      </div>
    `,
  });
}

async function sendEventInviteEmail(toEmail, eventTitle, organizerName, inviteLink) {
  await transporter.sendMail({
    from: env.email.from,
    to: toEmail,
    subject: `You're invited to "${eventTitle}" on SnapVault`,
    text: `Hi,\n\n${organizerName} has invited you to join the event "${eventTitle}" on SnapVault.\n\nSign up and join using this link:\n${inviteLink}\n\n— The SnapVault Team`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
        <h2 style="color: #1a1a2e;">You're invited!</h2>
        <p><strong>${organizerName}</strong> has invited you to join:</p>
        <div style="background: linear-gradient(135deg, #6C63FF, #A855F7); color: white; border-radius: 12px; padding: 20px; margin: 16px 0;">
          <h3 style="margin: 0; font-size: 20px;">${eventTitle}</h3>
        </div>
        <p>Click the button below to sign up for SnapVault and join the event:</p>
        <a href="${inviteLink}" style="display: inline-block; background: #6C63FF; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; margin: 8px 0;">Join Event</a>
        <p style="color: #888; font-size: 12px; margin-top: 20px;">— The SnapVault Team</p>
      </div>
    `,
  });
}

module.exports = { sendOtpEmail, sendAddedToEventEmail, sendEventInviteEmail };
