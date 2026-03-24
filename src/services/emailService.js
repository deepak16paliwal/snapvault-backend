const Mailjet = require('node-mailjet');
const env = require('../config/env');

const mailjet = Mailjet.apiConnect(env.email.apiKey, env.email.secretKey);

// ── Branded HTML wrapper ──────────────────────────────────────────────────────
function emailBase({ preheader = '', body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>SnapLivo</title>
  <style>
    @media only screen and (max-width:600px) {
      .email-wrap { padding: 12px 8px !important; }
      .email-card { padding: 20px 16px 16px !important; }
      .email-footer { padding: 12px 0 6px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#0A0F1E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0A0F1E;">
    <tr>
      <td align="center" class="email-wrap" style="padding:20px 12px;">
        <table width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:16px;">
              <span style="font-size:24px;font-weight:800;color:#62D0F5;letter-spacing:-0.5px;">SnapLivo</span>
            </td>
          </tr>
          <tr>
            <td class="email-card" style="background:#ffffff;border-radius:12px;padding:28px 24px 20px;box-shadow:0 4px 24px rgba(0,0,0,0.4);">
              ${body}
            </td>
          </tr>
          <tr>
            <td align="center" class="email-footer" style="padding:16px 0 8px;">
              <p style="margin:0;font-size:13px;color:#4B5563;">
                © 2026 SnapLivo &nbsp;·&nbsp;
                <a href="mailto:support@snaplivo.in" style="color:#62D0F5;text-decoration:none;">support@snaplivo.in</a>
              </p>
              <p style="margin:6px 0 0;font-size:12px;color:#374151;">Capture every moment. Find every memory.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Mailjet send helper ───────────────────────────────────────────────────────
async function sendEmail({ to, subject, html, text }) {
  await mailjet.post('send', { version: 'v3.1' }).request({
    Messages: [
      {
        From: { Email: env.email.fromAddress, Name: env.email.fromName },
        To: [{ Email: to }],
        Subject: subject,
        HTMLPart: html,
        TextPart: text,
      },
    ],
  });
}

// ─── 1. OTP ───────────────────────────────────────────────────────────────────
async function sendOtpEmail(toEmail, otp) {
  if (process.env.DEMO_EMAIL && toEmail === process.env.DEMO_EMAIL) return;

  const html = emailBase({
    preheader: `${otp} is your SnapLivo verification code`,
    body: `
      <h2 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">Verify your identity</h2>
      <p style="margin:0 0 20px;font-size:15px;color:#4B5563;">Use the code below to sign in to SnapLivo. It expires in <strong>10 minutes</strong>.</p>
      <div style="text-align:center;margin:0 0 24px;">
        <span style="display:inline-block;font-size:42px;font-weight:800;letter-spacing:12px;color:#0369A1;background:#F0F9FF;border-radius:10px;padding:14px 28px;">${otp}</span>
      </div>
      <p style="margin:0;font-size:13px;color:#6B7280;">If you did not request this code, you can safely ignore this email.</p>
    `,
  });

  await sendEmail({
    to: toEmail,
    subject: `${otp} is your SnapLivo verification code`,
    html,
    text: `Your SnapLivo verification code is: ${otp}\n\nValid for 10 minutes. Do not share this code with anyone.`,
  });
}

// ─── 2. Added to event ────────────────────────────────────────────────────────
async function sendAddedToEventEmail(toEmail, eventTitle, organizerName) {
  const html = emailBase({
    preheader: `${organizerName} added you to ${eventTitle}`,
    body: `
      <h2 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">You've been added to an event!</h2>
      <p style="margin:0 0 12px;font-size:15px;color:#4B5563;"><strong style="color:#111827;">${organizerName}</strong> has added you to:</p>
      <div style="background:linear-gradient(135deg,#0369A1,#62D0F5);color:#fff;border-radius:8px;padding:16px 20px;margin:0 0 20px;">
        <strong style="font-size:18px;">${eventTitle}</strong>
      </div>
      <p style="margin:0;font-size:15px;color:#4B5563;">Open the SnapLivo app to view photos and participate.</p>
    `,
  });

  await sendEmail({
    to: toEmail,
    subject: `You've been added to "${eventTitle}" on SnapLivo`,
    html,
    text: `${organizerName} has added you to the event "${eventTitle}" on SnapLivo.\n\nOpen the app to view photos and join the fun!\n\n— The SnapLivo Team`,
  });
}

// ─── 3. Event invite ──────────────────────────────────────────────────────────
async function sendEventInviteEmail(toEmail, eventTitle, organizerName, inviteLink) {
  const html = emailBase({
    preheader: `${organizerName} invited you to ${eventTitle}`,
    body: `
      <h2 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">You're invited!</h2>
      <p style="margin:0 0 12px;font-size:15px;color:#4B5563;"><strong style="color:#111827;">${organizerName}</strong> invited you to join:</p>
      <div style="background:linear-gradient(135deg,#0369A1,#62D0F5);color:#fff;border-radius:8px;padding:16px 20px;margin:0 0 20px;">
        <strong style="font-size:18px;">${eventTitle}</strong>
      </div>
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <a href="${inviteLink}" style="display:inline-block;background:#62D0F5;color:#0A0F1E;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Join Event</a>
          </td>
        </tr>
      </table>
    `,
  });

  await sendEmail({
    to: toEmail,
    subject: `You're invited to "${eventTitle}" on SnapLivo`,
    html,
    text: `${organizerName} has invited you to join the event "${eventTitle}" on SnapLivo.\n\nJoin using this link:\n${inviteLink}\n\n— The SnapLivo Team`,
  });
}

// ─── 4. Subscription expiry warning ──────────────────────────────────────────
async function sendSubscriptionExpiryWarning(toEmail, planName, expiryDate) {
  const formatted = expiryDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  const html = emailBase({
    preheader: `Your ${planName} plan expires on ${formatted}`,
    body: `
      <h2 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">Your plan expires soon</h2>
      <p style="margin:0 0 12px;font-size:15px;color:#4B5563;">Your <strong style="color:#111827;">${planName}</strong> plan will expire on <strong style="color:#111827;">${formatted}</strong>.</p>
      <p style="margin:0 0 24px;font-size:15px;color:#4B5563;">Renew now to keep your storage, events, and features active.</p>
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <a href="https://snaplivo.in/pricing" style="display:inline-block;background:#62D0F5;color:#0A0F1E;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Renew Now</a>
          </td>
        </tr>
      </table>
    `,
  });

  await sendEmail({
    to: toEmail,
    subject: `Your SnapLivo ${planName} plan expires on ${formatted}`,
    html,
    text: `Your SnapLivo ${planName} plan will expire on ${formatted}.\n\nRenew now to keep your photos, events, and features active.\n\n— The SnapLivo Team`,
  });
}

// ─── 5. Payment failed ────────────────────────────────────────────────────────
async function sendPaymentFailedEmail(toEmail, planName) {
  const html = emailBase({
    preheader: 'Action required: your SnapLivo payment failed',
    body: `
      <h2 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#DC2626;">Payment failed</h2>
      <p style="margin:0 0 12px;font-size:15px;color:#4B5563;">We were unable to process your payment for the <strong style="color:#111827;">${planName}</strong> plan.</p>
      <p style="margin:0 0 24px;font-size:15px;color:#4B5563;">You have a <strong>15-day grace period</strong> to complete your payment. After that, your account will be downgraded to the Free plan.</p>
      <p style="margin:0;font-size:15px;color:#4B5563;">Open the SnapLivo app to retry your payment.</p>
    `,
  });

  await sendEmail({
    to: toEmail,
    subject: 'Action required: SnapLivo payment failed',
    html,
    text: `We were unable to process your payment for the ${planName} plan.\n\nYou have a 15-day grace period to complete your payment. After that, your account will be downgraded to the Free plan.\n\nOpen the SnapLivo app to retry your payment.\n\n— The SnapLivo Team`,
  });
}

// ─── 6. Grace period expired ──────────────────────────────────────────────────
async function sendGracePeriodExpiredEmail(toEmail) {
  const html = emailBase({
    preheader: 'Your SnapLivo subscription has ended',
    body: `
      <h2 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">Subscription ended</h2>
      <p style="margin:0 0 12px;font-size:15px;color:#4B5563;">Your grace period has ended. Your account has been downgraded to the <strong>Free</strong> plan.</p>
      <p style="margin:0 0 24px;font-size:15px;color:#4B5563;">Your photos and events are safe, but premium features are now limited.</p>
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <a href="https://snaplivo.in/pricing" style="display:inline-block;background:#62D0F5;color:#0A0F1E;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Renew Now</a>
          </td>
        </tr>
      </table>
    `,
  });

  await sendEmail({
    to: toEmail,
    subject: 'Your SnapLivo subscription has ended',
    html,
    text: `Your grace period has ended and your account has been downgraded to the Free plan.\n\nYour photos and events are safe, but some premium features are now limited. Renew anytime to restore full access.\n\n— The SnapLivo Team`,
  });
}

// ─── 7. Contact form — admin notification ─────────────────────────────────────
async function sendContactAdminEmail(name, fromEmail, message) {
  const now = new Date().toLocaleString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });

  const html = emailBase({
    preheader: `New contact message from ${name}`,
    body: `
      <h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111827;">New Contact Message</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #E5E7EB;width:90px;font-size:14px;font-weight:600;color:#6B7280;">Name</td>
          <td style="padding:10px 0;border-bottom:1px solid #E5E7EB;font-size:15px;color:#111827;">${name}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #E5E7EB;font-size:14px;font-weight:600;color:#6B7280;">Email</td>
          <td style="padding:10px 0;border-bottom:1px solid #E5E7EB;font-size:15px;color:#111827;">
            <a href="mailto:${fromEmail}" style="color:#0369A1;">${fromEmail}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:10px 0;font-size:14px;font-weight:600;color:#6B7280;vertical-align:top;">Time</td>
          <td style="padding:10px 0;font-size:14px;color:#6B7280;">${now} IST</td>
        </tr>
      </table>
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#374151;">Message:</p>
      <div style="background:#F3F4F6;border-radius:8px;padding:16px 20px;margin-bottom:28px;">
        <p style="margin:0;font-size:15px;color:#111827;line-height:1.7;white-space:pre-wrap;">${message}</p>
      </div>
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <a href="mailto:${fromEmail}?subject=Re: Your SnapLivo enquiry" style="display:inline-block;background:#62D0F5;color:#0A0F1E;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;text-decoration:none;">Reply to ${name}</a>
          </td>
        </tr>
      </table>
    `,
  });

  await sendEmail({
    to: 'deepakpaliwal16@gmail.com',
    subject: `New Contact Message from ${name} <${fromEmail}>`,
    html,
    text: `New contact message from ${name} (${fromEmail})\n\nMessage:\n${message}\n\nTime: ${now} IST`,
  });
}

// ─── 8. Contact form — user confirmation ──────────────────────────────────────
async function sendContactConfirmationEmail(name, toEmail, message) {
  const html = emailBase({
    preheader: 'We received your message and will get back to you shortly',
    body: `
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">We got your message!</h2>
      <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.6;">
        Hi <strong style="color:#111827;">${name}</strong>,<br/><br/>
        Thank you for reaching out to SnapLivo. We've received your message and our team will get back to you within <strong style="color:#111827;">24–48 hours</strong>.
      </p>
      <div style="background:#F3F4F6;border-radius:8px;padding:16px 20px;margin-bottom:28px;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#6B7280;">Your message</p>
        <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;white-space:pre-wrap;">${message}</p>
      </div>
      <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr>
          <td>
            <a href="https://snaplivo.in" style="display:inline-block;background:#62D0F5;color:#0A0F1E;padding:13px 32px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">Visit SnapLivo</a>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;color:#6B7280;">
        If you have additional questions, reply to this email or write to us at
        <a href="mailto:support@snaplivo.in" style="color:#0369A1;">support@snaplivo.in</a>.
      </p>
      <p style="margin:12px 0 0;font-size:13px;color:#6B7280;">— The SnapLivo Team</p>
    `,
  });

  await sendEmail({
    to: toEmail,
    subject: 'We received your message — SnapLivo',
    html,
    text: `Hi ${name},\n\nThank you for reaching out to SnapLivo! We've received your message and will get back to you within 24–48 hours.\n\nYour message:\n"${message}"\n\nIn the meantime, visit us at https://snaplivo.in\n\n— The SnapLivo Team`,
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
