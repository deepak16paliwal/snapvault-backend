const Notification = require('../models/Notification');
const DeviceToken  = require('../models/DeviceToken');

// Lazy-initialize Firebase Admin so the server starts even without FCM config.
// To enable FCM: set FIREBASE_SERVICE_ACCOUNT env var to the base64-encoded
// contents of your Firebase service account JSON.
let messaging = null;

function getMessaging() {
  if (messaging) return messaging;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!b64) {
    console.warn('[FCM] FIREBASE_SERVICE_ACCOUNT not set — push notifications disabled');
    return null;
  }
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    messaging = admin.messaging();
    return messaging;
  } catch (err) {
    console.error('[FCM] Failed to init firebase-admin:', err.message);
    return null;
  }
}

/**
 * Send a push notification to a user and persist it in the DB.
 *
 * @param {object} opts
 * @param {number}  opts.userId   - recipient
 * @param {string}  opts.type     - e.g. 'face_scan_complete'
 * @param {string}  opts.title
 * @param {string}  opts.body
 * @param {object}  [opts.data]   - arbitrary key→string payload for deep-link
 */
async function sendNotification({ userId, type, title, body, data = {} }) {
  // 1. Persist in DB regardless of FCM status (in-app bell always works)
  const notif = await Notification.create({ user_id: userId, type, title, body, data_json: data });

  // 2. Send FCM push to all registered device tokens for this user
  const fcm = getMessaging();
  if (!fcm) return notif;

  const tokens = await DeviceToken.findAll({ where: { user_id: userId } });
  if (!tokens.length) return notif;

  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)])
  );

  const messages = tokens.map(t => ({
    token: t.fcm_token,
    notification: { title, body },
    data: { type, ...stringData },
    android: { priority: 'high' },
    apns: { payload: { aps: { sound: 'default' } } },
  }));

  try {
    const res = await fcm.sendEach(messages);
    // Remove stale tokens (NotRegistered / InvalidRegistration)
    const stale = [];
    res.responses.forEach((r, i) => {
      if (!r.success && ['messaging/registration-token-not-registered',
          'messaging/invalid-registration-token'].includes(r.error?.code)) {
        stale.push(tokens[i].fcm_token);
      }
    });
    if (stale.length) {
      await DeviceToken.destroy({ where: { fcm_token: stale } });
    }
  } catch (err) {
    console.error('[FCM] sendEach error:', err.message);
  }

  return notif;
}

module.exports = { sendNotification };
