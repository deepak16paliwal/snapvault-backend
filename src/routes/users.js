const express = require('express');
const router = express.Router();
const { User, Event, EventMember, Photo } = require('../models');
const { authenticate } = require('../middleware/authMiddleware');
const { getDownloadUrl, presignStoredUrl } = require('../services/s3Service');

// GET /users/:id/profile
// Returns organizer profile info + events shared between the organizer and the requesting user.
router.get('/:id/profile', authenticate, async (req, res) => {
  try {
    const organizerId = parseInt(req.params.id, 10);
    if (isNaN(organizerId)) return res.status(400).json({ error: 'Invalid user id' });

    const organizer = await User.findByPk(organizerId, {
      attributes: ['id', 'name', 'email', 'phone', 'role', 'profile_photo_url'],
    });
    if (!organizer) return res.status(404).json({ error: 'User not found' });

    let profilePhotoUrl = null;
    if (organizer.profile_photo_url) {
      try { profilePhotoUrl = await presignStoredUrl(organizer.profile_photo_url, 3600); } catch (_) {}
    }

    // Events in common: organizer owns the event AND the requesting user is a member
    const sharedEvents = await Event.findAll({
      where: {
        organizer_id: organizerId,
        is_active: true,
        soft_deleted_at: null,
      },
      include: [
        {
          model: EventMember,
          where: { user_id: req.user.id },
          required: true,
          attributes: [],
        },
      ],
      attributes: ['id', 'title', 'cover_storage_key'],
      order: [['created_at', 'DESC']],
    });

    // Generate cover photo presigned URLs
    const eventsInCommon = await Promise.all(
      sharedEvents.map(async (ev) => {
        let coverPhotoUrl = null;
        if (ev.cover_storage_key) {
          try {
            coverPhotoUrl = await getDownloadUrl(ev.cover_storage_key, 3600);
          } catch (_) {}
        }
        // Photo count
        const photoCount = await Photo.count({
          where: { event_id: ev.id, status: 'uploaded' },
        });
        return {
          id: ev.id,
          title: ev.title,
          cover_photo_url: coverPhotoUrl,
          photo_count: photoCount,
        };
      })
    );

    res.json({
      id: organizer.id,
      name: organizer.name,
      email: organizer.email,
      phone: organizer.phone,
      role: organizer.role,
      profile_photo_url: profilePhotoUrl,
      events_in_common: eventsInCommon,
    });
  } catch (err) {
    console.error('[Users] GET /users/:id/profile error:', err.message);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

module.exports = router;
