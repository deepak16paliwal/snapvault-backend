const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const ConnectionRequest = require('../models/ConnectionRequest');
const { Event, User } = require('../models');
const { presignStoredUrl } = require('../services/s3Service');

// ── GET /connect/requests ─────────────────────────────────────────────────────
// Organizer fetches all connection requests sent to them across all events
router.get('/requests', authenticate, async (req, res) => {
  try {
    const requests = await ConnectionRequest.findAll({
      where: { organizer_id: req.user.id },
      order: [['created_at', 'DESC']],
    });

    if (!requests.length) return res.json({ requests: [] });

    // Batch-fetch requesters and events
    const requesterIds = [...new Set(requests.map(r => r.requester_id))];
    const eventIds     = [...new Set(requests.map(r => r.event_id))];

    const [users, events] = await Promise.all([
      User.findAll({
        where: { id: requesterIds },
        attributes: ['id', 'name', 'email', 'phone', 'profile_photo_url'],
      }),
      Event.findAll({
        where: { id: eventIds },
        attributes: ['id', 'title'],
      }),
    ]);

    const userMap  = Object.fromEntries(users.map(u => [u.id, u.toJSON()]));
    const eventMap = Object.fromEntries(events.map(e => [e.id, e.toJSON()]));

    // Resolve profile photo signed URLs
    const enriched = await Promise.all(requests.map(async (r) => {
      const user  = userMap[r.requester_id] || {};
      const event = eventMap[r.event_id]    || {};

      let profile_photo_url = null;
      if (user.profile_photo_url) {
        try { profile_photo_url = await presignStoredUrl(user.profile_photo_url, 3600); } catch (_) {}
      }

      return {
        id:          r.id,
        event_id:    r.event_id,
        event_title: event.title || '',
        message:     r.message,
        created_at:  r.created_at,
        requester: {
          id:                user.id,
          name:              user.name,
          email:             user.email,
          phone:             user.phone,
          profile_photo_url,
        },
      };
    }));

    res.json({ requests: enriched });
  } catch (err) {
    console.error('Connection requests error:', err);
    res.status(500).json({ error: 'Failed to fetch connection requests' });
  }
});

module.exports = router;
