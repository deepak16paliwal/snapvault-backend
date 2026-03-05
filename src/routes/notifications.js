const express  = require('express');
const { Op }   = require('sequelize');
const auth     = require('../middleware/auth');
const Notification = require('../models/Notification');
const DeviceToken  = require('../models/DeviceToken');

const router = express.Router();

// ── GET /notifications ────────────────────────────────────────────────────────
// Returns up to 50 most recent notifications for the current user.
// Also returns unread_count for badge.
router.get('/', auth, async (req, res) => {
  try {
    const [notifications, unreadCount] = await Promise.all([
      Notification.findAll({
        where: { user_id: req.user.id },
        order: [['created_at', 'DESC']],
        limit: 50,
      }),
      Notification.count({ where: { user_id: req.user.id, is_read: false } }),
    ]);
    res.json({ notifications, unread_count: unreadCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

// ── GET /notifications/unread-count ──────────────────────────────────────────
// Lightweight poll endpoint for the badge only.
router.get('/unread-count', auth, async (req, res) => {
  try {
    const count = await Notification.count({ where: { user_id: req.user.id, is_read: false } });
    res.json({ unread_count: count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// ── PATCH /notifications/:id/read ─────────────────────────────────────────────
router.patch('/:id/read', auth, async (req, res) => {
  try {
    const notif = await Notification.findOne({
      where: { id: req.params.id, user_id: req.user.id },
    });
    if (!notif) return res.status(404).json({ error: 'Not found' });
    await notif.update({ is_read: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// ── PATCH /notifications/read-all ─────────────────────────────────────────────
router.patch('/read-all', auth, async (req, res) => {
  try {
    await Notification.update(
      { is_read: true },
      { where: { user_id: req.user.id, is_read: false } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// ── POST /notifications/device-token ─────────────────────────────────────────
// Register or refresh an FCM device token. Safe to call on every app start.
router.post('/device-token', auth, async (req, res) => {
  const { fcm_token, platform } = req.body;
  if (!fcm_token || !['ios', 'android'].includes(platform)) {
    return res.status(400).json({ error: 'fcm_token and platform (ios|android) required' });
  }
  try {
    await DeviceToken.upsert({
      user_id: req.user.id,
      fcm_token,
      platform,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to register device token' });
  }
});

// ── DELETE /notifications/device-token ───────────────────────────────────────
// Unregister token on logout.
router.delete('/device-token', auth, async (req, res) => {
  const { fcm_token } = req.body;
  if (!fcm_token) return res.status(400).json({ error: 'fcm_token required' });
  try {
    await DeviceToken.destroy({ where: { user_id: req.user.id, fcm_token } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove device token' });
  }
});

module.exports = router;
