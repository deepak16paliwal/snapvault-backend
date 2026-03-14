const Mailjet = require('node-mailjet');
const env = require('../config/env');

const mailjet = Mailjet.apiConnect(env.email.apiKey, env.email.secretKey);

// Shared branded HTML wrapper
function emailBase({ preheader = '', body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SnapLivo</title>
</head>
<body style="margin:0;padding:0;background-color:#0A0F1E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0A0F1E;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <span style="font-size:26px;font-weight:800;color:#62D0F5;letter-spacing:-0.5px;">SnapLivo</span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:12px;padding:36px 36px 28px;box-shadow:0 4px 24px rgba(0,0,0,0.4);">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:28px 0 8px;">
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
    preheader: `Your SnapLivo verification code is ${otp}`,
    body: `
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Verify your email</h2>
      <p style="margin:0 0 28px;font-size:15px;color:#4B5563;line-height:1.6;">
        Use the code below to sign in to SnapLivo. It expires in <strong>10 minutes</strong>.
      </p>
      <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:28px;text-align:center;margin-bottom:28px;">
        <span style="font-size:48px;font-weight:800;letter-spacing:14px;color:#0369A1;font-variant-numeric:tabular-nums;">${otp}</span>
      </div>
      <p style="margin:0;font-size:13px;color:#6B7280;line-height:1.6;">
        If you didn't request this, you can safely ignore this email. Never share this code with anyone.
      </p>
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
    preheader: `${organizerName} added you to "${eventTitle}"`,
    body: `
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">You've been added to an event!</h2>
      <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.6;">
        <strong style="color:#111827;">${organizerName}</strong> has added you to the following event on SnapLivo:
      </p>
      <div style="background:linear-gradient(135deg,#0369A1,#0891B2);border-radius:10px;padding:22px 24px;margin-bottom:28px;">
        <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,0.7);">Event</p>
        <p style="margin:6px 0 0;font-size:20px;font-weight:700;color:#ffffff;">${eventTitle}</p>
      </div>
      <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.6;">
        Open the SnapLivo app to view photos and join the celebration.
      </p>
      <p style="margin:0;font-size:13px;color:#6B7280;">— The SnapLivo Team</p>
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
    preheader: `${organizerName} invited you to "${eventTitle}"`,
    body: `
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">You're invited!</h2>
      <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.6;">
        <strong style="color:#111827;">${organizerName}</strong> has invited you to join an event on SnapLivo — where you can instantly find your photos using face recognition.
      </p>
      <div style="background:linear-gradient(135deg,#0369A1,#0891B2);border-radius:10px;padding:22px 24px;margin-bottom:28px;">
        <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,0.7);">Event</p>
        <p style="margin:6px 0 0;font-size:20px;font-weight:700;color:#ffffff;">${eventTitle}</p>
      </div>
      <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr>
          <td>
            <a href="${inviteLink}" style="display:inline-block;background:#62D0F5;color:#0A0F1E;padding:13px 32px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">Join Event</a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 8px;font-size:13px;color:#6B7280;">
        Or copy this link into your browser:<br/>
        <a href="${inviteLink}" style="color:#0369A1;word-break:break-all;">${inviteLink}</a>
      </p>
      <p style="margin:16px 0 0;font-size:13px;color:#6B7280;">— The SnapLivo Team</p>
    `,
  });

  await sendEmail({
    to: toEmail,
    subject: `You're invited to "${eventTitle}" on SnapLivo`,
    html,
    text: `${organizerName} has invited you to join the event "${eventTitle}" on SnapLivo.\n\nSign up and join using this link:\n${inviteLink}\n\n— The SnapLivo Team`,
  });
}

// ─── 4. Subscription expiry warning ──────────────────────────────────────────

async function sendSubscriptionExpiryWarning(toEmail, planName, expiryDate) {
  const formatted = expiryDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  const html = emailBase({
    preheader: `Your ${planName} plan expires on ${formatted}`,
    body: `
      <div style="background:#FEF3C7;border-left:4px solid #F59E0B;border-radius:6px;padding:14px 18px;margin-bottom:24px;">
        <p style="margin:0;font-size:14px;font-weight:600;color:#92400E;">⚠️ Your plan expires in 7 days</p>
      </div>
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Renew to keep access</h2>
      <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.6;">
        Your <strong style="color:#111827;">${planName}</strong> plan on SnapLivo will expire on
        <strong style="color:#111827;">${formatted}</strong>.
        Renew now to keep your events, photos, and premium features active without interruption.
      </p>
      <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr>
          <td>
            <a href="https://snaplivo.in/pricing" style="display:inline-block;background:#62D0F5;color:#0A0F1E;padding:13px 32px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">Renew Now</a>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;color:#6B7280;">— The SnapLivo Team</p>
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
    preheader: `Action required: payment failed for your ${planName} plan`,
    body: `
      <div style="background:#FEE2E2;border-left:4px solid #EF4444;border-radius:6px;padding:14px 18px;margin-bottom:24px;">
        <p style="margin:0;font-size:14px;font-weight:600;color:#991B1B;">Payment unsuccessful</p>
      </div>
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">We couldn't process your payment</h2>
      <p style="margin:0 0 16px;font-size:15px;color:#4B5563;line-height:1.6;">
        We were unable to charge your payment method for the
        <strong style="color:#111827;">${planName}</strong> plan.
      </p>
      <p style="margin:0 0 28px;font-size:15px;color:#4B5563;line-height:1.6;">
        You have a <strong style="color:#111827;">15-day grace period</strong> to complete your payment.
        After that, your account will be automatically downgraded to the Free plan and some features
        may become unavailable.
      </p>
      <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr>
          <td>
            <a href="https://snaplivo.in" style="display:inline-block;background:#62D0F5;color:#0A0F1E;padding:13px 32px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">Retry Payment</a>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;color:#6B7280;">
        If you need help, contact us at
        <a href="mailto:support@snaplivo.in" style="color:#0369A1;">support@snaplivo.in</a>
      </p>
      <p style="margin:12px 0 0;font-size:13px;color:#6B7280;">— The SnapLivo Team</p>
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
    preheader: 'Your SnapLivo subscription has ended — account downgraded to Free',
    body: `
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Your subscription has ended</h2>
      <p style="margin:0 0 16px;font-size:15px;color:#4B5563;line-height:1.6;">
        Your grace period has ended and your account has been downgraded to the
        <strong style="color:#111827;">Free</strong> plan.
      </p>
      <p style="margin:0 0 28px;font-size:15px;color:#4B5563;line-height:1.6;">
        Your photos and events are safe. Renew anytime to restore full access to premium features,
        higher storage limits, and bulk downloads.
      </p>
      <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr>
          <td>
            <a href="https://snaplivo.in/pricing" style="display:inline-block;background:#62D0F5;color:#0A0F1E;padding:13px 32px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">Upgrade Now</a>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;color:#6B7280;">— The SnapLivo Team</p>
    `,
  });

  await sendEmail({
    to: toEmail,
    subject: 'Your SnapLivo subscription has ended',
    html,
    text: `Your grace period has ended and your account has been downgraded to the Free plan.\n\nYour photos and events are safe, but some premium features are now limited. Renew anytime to restore full access.\n\n— The SnapLivo Team`,
  });
}

module.exports = {
  sendOtpEmail,
  sendAddedToEventEmail,
  sendEventInviteEmail,
  sendSubscriptionExpiryWarning,
  sendPaymentFailedEmail,
  sendGracePeriodExpiredEmail,
};
