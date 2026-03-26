const express  = require('express');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const Notification = require('../models/Notification');
const DeviceToken  = require('../models/DeviceToken');
const { Event, EventMember, User } = require('../models');
const { sendNotification } = require('../services/notificationService');

const router = express.Router();

// ── GET /notifications ────────────────────────────────────────────────────────
// Returns up to 50 most recent notifications for the current user.
// Also returns unread_count for badge.
router.get('/', authenticate, async (req, res) => {
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
router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const count = await Notification.count({ where: { user_id: req.user.id, is_read: false } });
    res.json({ unread_count: count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// ── PATCH /notifications/:id/read ─────────────────────────────────────────────
router.patch('/:id/read', authenticate, async (req, res) => {
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
router.patch('/read-all', authenticate, async (req, res) => {
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
router.post('/device-token', authenticate, async (req, res) => {
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
router.delete('/device-token', authenticate, async (req, res) => {
  const { fcm_token } = req.body;
  if (!fcm_token) return res.status(400).json({ error: 'fcm_token required' });
  try {
    await DeviceToken.destroy({ where: { user_id: req.user.id, fcm_token } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove device token' });
  }
});

// ── POST /notifications/broadcast ────────────────────────────────────────────
// Organizer sends a push notification to ALL members of an event.
// Body: { event_id, message_type: 'template'|'custom', custom_message? }
// Template message: "New photos have been added to <event title>"
router.post('/broadcast', authenticate, requireRole('organizer'), async (req, res) => {
  const { event_id, message_type, custom_message } = req.body;
  if (!event_id || !message_type) {
    return res.status(400).json({ error: 'event_id and message_type required' });
  }

  try {
    const event = await Event.findOne({
      where: { id: event_id, organizer_id: req.user.id, is_active: true },
    });
    if (!event) return res.status(404).json({ error: 'Event not found or not authorized' });

    const members = await EventMember.findAll({
      where: { event_id, role: 'member' },
      attributes: ['user_id'],
    });
    if (!members.length) return res.json({ success: true, sent: 0 });

    const notifBody = message_type === 'custom' && custom_message?.trim()
      ? custom_message.trim().slice(0, 200)
      : `New photos have been added to "${event.title}" — check them out!`;

    await Promise.all(
      members.map(m =>
        sendNotification({
          userId: m.user_id,
          type:   'organizer_broadcast',
          title:  event.title,
          body:   notifBody,
          data:   { event_id: String(event_id), screen: 'gallery' },
        })
      )
    );

    res.json({ success: true, sent: members.length });
  } catch (err) {
    console.error('Broadcast error:', err);
    res.status(500).json({ error: 'Failed to send broadcast notification' });
  }
});

// ── POST /notifications/targeted ─────────────────────────────────────────────
// Organizer sends a push notification to specific member(s) of an event.
// Body: { event_id, user_ids: number[], message_type: 'template'|'custom', custom_message? }
// Template message: "Your photos are ready in <event title>"
router.post('/targeted', authenticate, requireRole('organizer'), async (req, res) => {
  const { event_id, user_ids, message_type, custom_message } = req.body;
  if (!event_id || !Array.isArray(user_ids) || !user_ids.length || !message_type) {
    return res.status(400).json({ error: 'event_id, user_ids[] and message_type required' });
  }

  try {
    const event = await Event.findOne({
      where: { id: event_id, organizer_id: req.user.id, is_active: true },
    });
    if (!event) return res.status(404).json({ error: 'Event not found or not authorized' });

    // Verify all target users are actually members
    const members = await EventMember.findAll({
      where: { event_id, user_id: user_ids },
      attributes: ['user_id'],
    });
    if (!members.length) return res.status(400).json({ error: 'No valid members found' });

    const notifBody = message_type === 'custom' && custom_message?.trim()
      ? custom_message.trim().slice(0, 200)
      : `Your photos are ready in "${event.title}" — tap to view them!`;

    await Promise.all(
      members.map(m =>
        sendNotification({
          userId: m.user_id,
          type:   'organizer_targeted',
          title:  event.title,
          body:   notifBody,
          data:   { event_id: String(event_id), screen: 'gallery' },
        })
      )
    );

    res.json({ success: true, sent: members.length });
  } catch (err) {
    console.error('Targeted notification error:', err);
    res.status(500).json({ error: 'Failed to send targeted notification' });
  }
});

module.exports = router;
