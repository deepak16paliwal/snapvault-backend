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

// ── Shared HTML wrapper — mobile-compatible ───────────────────────────────────
function emailBase(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <style>
    body { margin: 0; padding: 0; background-color: #0A0F1E; }
    @media only screen and (max-width: 600px) {
      .email-card { padding: 20px 16px 16px !important; }
      .email-wrap { padding: 12px 8px !important; }
      .email-footer { padding: 12px 0 8px !important; }
    }
  </style>
</head>
<body>
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0A0F1E;">
    <tr>
      <td align="center" class="email-wrap" style="padding:20px 12px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
          <!-- Header -->
          <tr>
            <td align="center" style="padding:0 0 16px 0;">
              <span style="font-family:sans-serif;font-size:24px;font-weight:800;color:#62D0F5;letter-spacing:1px;">SnapLivo</span>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td class="email-card" style="background:#ffffff;border-radius:10px;padding:28px 28px 20px;font-family:sans-serif;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" class="email-footer" style="padding:16px 0 8px;font-family:sans-serif;font-size:12px;color:#6B7280;">
              <a href="mailto:support@snaplivo.in" style="color:#62D0F5;text-decoration:none;">support@snaplivo.in</a>
              &nbsp;·&nbsp; SnapLivo
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Email functions ───────────────────────────────────────────────────────────

async function sendOtpEmail(toEmail, otp) {
  // Demo account — skip SMTP entirely
  if (process.env.DEMO_EMAIL && toEmail === process.env.DEMO_EMAIL) return;

  await transporter.sendMail({
    from: env.email.from,
    to: toEmail,
    subject: 'Your SnapLivo OTP',
    text: `Your SnapLivo OTP is: ${otp}\n\nThis code is valid for 10 minutes. Do not share it with anyone.`,
    html: emailBase(`
      <h2 style="margin:0 0 12px;color:#0A0F1E;font-size:20px;">Verify your identity</h2>
      <p style="color:#444;margin:0 0 16px;">Your one-time password is:</p>
      <div style="font-size:42px;font-weight:800;letter-spacing:12px;color:#0A7BBF;margin:0 0 20px;text-align:center;">${otp}</div>
      <p style="color:#666;font-size:13px;margin:0;">Valid for <strong>10 minutes</strong>. Do not share this code with anyone.</p>
    `),
  });
}

async function sendAddedToEventEmail(toEmail, eventTitle, organizerName) {
  await transporter.sendMail({
    from: env.email.from,
    to: toEmail,
    subject: `You've been added to "${eventTitle}" on SnapLivo`,
    text: `Hi,\n\n${organizerName} has added you to the event "${eventTitle}" on SnapLivo.\n\nOpen the app to view photos and join the fun!\n\n— SnapLivo`,
    html: emailBase(`
      <h2 style="margin:0 0 12px;color:#0A0F1E;font-size:20px;">You've been added to an event!</h2>
      <p style="color:#444;margin:0 0 12px;"><strong>${organizerName}</strong> has added you to:</p>
      <div style="background:linear-gradient(135deg,#0A7BBF,#62D0F5);color:#fff;border-radius:8px;padding:16px 20px;margin:0 0 16px;">
        <strong style="font-size:18px;">${eventTitle}</strong>
      </div>
      <p style="color:#555;margin:0 0 16px;">Open the SnapLivo app to view photos and participate.</p>
    `),
  });
}

async function sendEventInviteEmail(toEmail, eventTitle, organizerName, inviteLink) {
  await transporter.sendMail({
    from: env.email.from,
    to: toEmail,
    subject: `You're invited to "${eventTitle}" on SnapLivo`,
    text: `Hi,\n\n${organizerName} has invited you to join the event "${eventTitle}" on SnapLivo.\n\nJoin here:\n${inviteLink}\n\n— SnapLivo`,
    html: emailBase(`
      <h2 style="margin:0 0 12px;color:#0A0F1E;font-size:20px;">You're invited!</h2>
      <p style="color:#444;margin:0 0 12px;"><strong>${organizerName}</strong> invited you to join:</p>
      <div style="background:linear-gradient(135deg,#0A7BBF,#62D0F5);color:#fff;border-radius:8px;padding:16px 20px;margin:0 0 20px;">
        <strong style="font-size:18px;">${eventTitle}</strong>
      </div>
      <a href="${inviteLink}" style="display:inline-block;background:#62D0F5;color:#0A0F1E;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Join Event</a>
    `),
  });
}

async function sendSubscriptionExpiryWarning(toEmail, planName, expiryDate) {
  const formatted = expiryDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  await transporter.sendMail({
    from: env.email.from,
    to: toEmail,
    subject: `Your SnapLivo ${planName} plan expires in 7 days`,
    text: `Hi,\n\nYour SnapLivo ${planName} plan will expire on ${formatted}.\n\nRenew now to keep your photos, events, and features active.\n\n— SnapLivo`,
    html: emailBase(`
      <h2 style="margin:0 0 12px;color:#0A0F1E;font-size:20px;">⚠️ Your plan expires soon</h2>
      <p style="color:#444;margin:0 0 12px;">Your <strong>${planName}</strong> plan will expire on <strong>${formatted}</strong>.</p>
      <p style="color:#555;margin:0 0 20px;">Renew now to keep your storage, events, and features active.</p>
      <a href="https://snaplivo.in/pricing" style="display:inline-block;background:#62D0F5;color:#0A0F1E;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Renew Now</a>
    `),
  });
}

async function sendPaymentFailedEmail(toEmail, planName) {
  await transporter.sendMail({
    from: env.email.from,
    to: toEmail,
    subject: 'SnapLivo payment failed — action required',
    text: `Hi,\n\nWe were unable to process your payment for the ${planName} plan.\n\nYou have a 15-day grace period to complete your payment. After that, your account will be downgraded to the Free plan.\n\nOpen the app to retry your payment.\n\n— SnapLivo`,
    html: emailBase(`
      <h2 style="margin:0 0 12px;color:#dc2626;font-size:20px;">Payment failed</h2>
      <p style="color:#444;margin:0 0 12px;">We were unable to process your payment for the <strong>${planName}</strong> plan.</p>
      <p style="color:#555;margin:0 0 20px;">You have a <strong>15-day grace period</strong> to complete your payment. After that, your account will be downgraded to the Free plan.</p>
      <p style="color:#555;margin:0;">Open the SnapLivo app to retry your payment.</p>
    `),
  });
}

async function sendGracePeriodExpiredEmail(toEmail) {
  await transporter.sendMail({
    from: env.email.from,
    to: toEmail,
    subject: 'Your SnapLivo subscription has ended',
    text: `Hi,\n\nYour grace period has ended and your account has been downgraded to the Free plan.\n\nYour photos and events are safe, but some premium features are now limited. Renew anytime to restore full access.\n\n— SnapLivo`,
    html: emailBase(`
      <h2 style="margin:0 0 12px;color:#0A0F1E;font-size:20px;">Subscription ended</h2>
      <p style="color:#444;margin:0 0 12px;">Your grace period has ended. Your account has been downgraded to the <strong>Free</strong> plan.</p>
      <p style="color:#555;margin:0 0 20px;">Your photos and events are safe, but premium features are now limited.</p>
      <a href="https://snaplivo.in/pricing" style="display:inline-block;background:#62D0F5;color:#0A0F1E;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Renew Now</a>
    `),
  });
}

async function sendContactAdminEmail(name, fromEmail, message) {
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  await transporter.sendMail({
    from: env.email.from,
    to: 'deepakpaliwal16@gmail.com',
    subject: `New Contact Message from ${name}`,
    text: `Name: ${name}\nEmail: ${fromEmail}\n\nMessage:\n${message}\n\nReceived at: ${timestamp}`,
    html: emailBase(`
      <h2 style="margin:0 0 12px;color:#0A0F1E;font-size:20px;">New Contact Message</h2>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">
        <tr><td style="padding:6px 0;color:#666;font-size:13px;width:60px;">Name</td><td style="padding:6px 0;color:#111;font-weight:600;">${name}</td></tr>
        <tr><td style="padding:6px 0;color:#666;font-size:13px;">Email</td><td style="padding:6px 0;"><a href="mailto:${fromEmail}" style="color:#0A7BBF;">${fromEmail}</a></td></tr>
      </table>
      <div style="background:#f3f4f6;border-radius:6px;padding:14px 16px;margin:0 0 20px;color:#333;font-size:14px;line-height:1.6;white-space:pre-wrap;">${message}</div>
      <a href="mailto:${fromEmail}" style="display:inline-block;background:#62D0F5;color:#0A0F1E;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Reply to ${name}</a>
      <p style="color:#999;font-size:11px;margin:16px 0 0;">Received: ${timestamp} IST</p>
    `),
  });
}

async function sendContactConfirmationEmail(name, toEmail, message) {
  await transporter.sendMail({
    from: env.email.from,
    to: toEmail,
    subject: 'We received your message — SnapLivo',
    text: `Hi ${name},\n\nThanks for reaching out! We've received your message and will get back to you within 24–48 hours.\n\nYour message:\n${message}\n\n— SnapLivo\nsupport@snaplivo.in`,
    html: emailBase(`
      <h2 style="margin:0 0 12px;color:#0A0F1E;font-size:20px;">We got your message!</h2>
      <p style="color:#444;margin:0 0 12px;">Hi <strong>${name}</strong>,</p>
      <p style="color:#555;margin:0 0 16px;">Thanks for reaching out to SnapLivo! We've received your message and will get back to you within <strong>24–48 hours</strong>.</p>
      <p style="color:#666;font-size:13px;margin:0 0 6px;">Your message:</p>
      <div style="background:#f3f4f6;border-radius:6px;padding:14px 16px;margin:0 0 20px;color:#444;font-size:14px;line-height:1.6;white-space:pre-wrap;">${message}</div>
      <p style="color:#555;margin:0 0 20px;">In the meantime, feel free to explore SnapLivo.</p>
      <a href="https://snaplivo.in" style="display:inline-block;background:#62D0F5;color:#0A0F1E;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Visit SnapLivo</a>
    `),
  });
}

module.exports = {
  sendOtpEmail,
  sendAddedToEventEmail,
  sendEventInviteEmail,
  sendSubscriptionExpiryWarning,
  sendPaymentFailedEmail,
  sendGracePeriodExpiredEmail,
  sendContactAdminEmail,
  sendContactConfirmationEmail,
};
