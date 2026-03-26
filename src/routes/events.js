const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const { Event, EventMember, User, Photo } = require('../models');
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { sendAddedToEventEmail, sendEventInviteEmail } = require('../services/emailService');
const { getUploadUrl, getDownloadUrl } = require('../services/s3Service');
const { createEventCollection } = require('../services/rekognitionService');

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return false;
  }
  return true;
}

// POST /events — Create event (organizer only)
router.post('/', authenticate, requireRole('organizer'), [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('description').optional().trim(),
  body('event_date').optional().isDate().withMessage('Invalid date (YYYY-MM-DD)'),
  body('location').optional().trim(),
  body('cover_photo_url').optional().isURL().withMessage('Invalid URL'),
  body('expires_at').optional().isISO8601().withMessage('Invalid expires_at (ISO 8601)'),
], async (req, res) => {
  if (!validate(req, res)) return;

  const { title, description, event_date, location, cover_photo_url, expires_at } = req.body;

  try {
    const invite_token = crypto.randomBytes(32).toString('hex');

    const event = await Event.create({
      organizer_id: req.user.id,
      title,
      description,
      event_date,
      location,
      cover_photo_url,
      invite_token,
      expires_at: expires_at || null,
    });

    // Add organizer as member automatically (full access)
    await EventMember.create({
      event_id: event.id,
      user_id: req.user.id,
      role: 'organizer',
      access_type: 'full',
    });

    // Create per-event Rekognition collection (fire-and-forget — don't block response)
    createEventCollection(event.id).catch((err) =>
      console.error(`[Rekognition] Failed to create collection for event ${event.id}:`, err.message)
    );

    res.status(201).json({ event });
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// GET /events — List events the current user belongs to
router.get('/', authenticate, async (req, res) => {
  try {
    const memberships = await EventMember.findAll({
      where: { user_id: req.user.id },
      include: [{
        model: Event,
        where: { is_active: true },
        include: [{ model: User, as: 'organizer', attributes: ['id', 'name', 'email'] }],
      }],
    });

    const eventIds = memberships.map(m => m.Event.id);

    // Fetch aggregated stats for all events in one go (avoids N+1)
    let memberCounts = {}, photoCounts = {}, scanTotals = {};
    if (eventIds.length > 0) {
      const [memberRows] = await sequelize.query(
        `SELECT event_id, COUNT(*) as cnt FROM event_members WHERE event_id IN (:ids) GROUP BY event_id`,
        { replacements: { ids: eventIds } }
      );
      const [photoRows] = await sequelize.query(
        `SELECT event_id, COUNT(*) as cnt FROM photos WHERE event_id IN (:ids) GROUP BY event_id`,
        { replacements: { ids: eventIds } }
      );
      const [scanRows] = await sequelize.query(
        `SELECT event_id, SUM(face_scan_count) as total FROM event_members WHERE event_id IN (:ids) GROUP BY event_id`,
        { replacements: { ids: eventIds } }
      );
      memberRows.forEach(r => { memberCounts[r.event_id] = parseInt(r.cnt, 10); });
      photoRows.forEach(r => { photoCounts[r.event_id] = parseInt(r.cnt, 10); });
      scanRows.forEach(r => { scanTotals[r.event_id] = parseInt(r.total, 10) || 0; });
    }

    const events = await Promise.all(memberships.map(async m => ({
      ...m.Event.toJSON(),
      cover_photo_url: m.Event.cover_storage_key
        ? await getDownloadUrl(m.Event.cover_storage_key)
        : m.Event.cover_photo_url || null,
      my_role: m.role,
      my_access_type: m.access_type,
      my_face_scan_count: m.face_scan_count,
      member_count: memberCounts[m.Event.id] || 0,
      photo_count: photoCounts[m.Event.id] || 0,
      total_scans: scanTotals[m.Event.id] || 0,
    })));

    res.json({ events });
  } catch (err) {
    console.error('List events error:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// POST /events/join/:token — Join event via invite link (must be before /:id routes)
router.post('/join/:token', authenticate, async (req, res) => {
  try {
    const event = await Event.findOne({
      where: { invite_token: req.params.token, is_active: true },
    });

    if (!event) {
      return res.status(404).json({ error: 'Invalid or expired invite link' });
    }

    const existing = await EventMember.findOne({
      where: { event_id: event.id, user_id: req.user.id },
    });

    if (existing) {
      return res.status(409).json({ error: 'You are already a member of this event', event_id: event.id });
    }

    await EventMember.create({
      event_id: event.id,
      user_id: req.user.id,
      role: 'guest',
    });

    res.status(201).json({
      message: 'Joined event successfully',
      event_id: event.id,
      invite_link: `${process.env.FRONTEND_URL || 'https://snaplivo.in'}/join/${event.invite_token}`,
    });
  } catch (err) {
    console.error('Join event error:', err);
    res.status(500).json({ error: 'Failed to join event' });
  }
});

// GET /events/:id — Get event detail (members only)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const event = await Event.findOne({
      where: { id: req.params.id, is_active: true },
      include: [{ model: User, as: 'organizer', attributes: ['id', 'name', 'email'] }],
    });

    if (!event) return res.status(404).json({ error: 'Event not found' });

    const membership = await EventMember.findOne({
      where: { event_id: event.id, user_id: req.user.id },
    });

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this event' });
    }

    const photoCount = await Photo.count({ where: { event_id: event.id, status: 'uploaded' } });

    res.json({
      event: {
        ...event.toJSON(),
        cover_photo_url: event.cover_storage_key
          ? await getDownloadUrl(event.cover_storage_key)
          : event.cover_photo_url || null,
        invite_link: membership.role === 'organizer'
          ? `${process.env.FRONTEND_URL || 'https://snaplivo.in'}/join/${event.invite_token}`
          : undefined,
        photo_count: photoCount,
      },
      my_role: membership.role,
      my_access_type: membership.access_type,
      my_face_scan_count: membership.face_scan_count,
    });
  } catch (err) {
    console.error('Get event error:', err);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// PATCH /events/:id — Update event (organizer only)
router.patch('/:id', authenticate, requireRole('organizer'), [
  body('title').optional().trim().notEmpty().withMessage('Title cannot be empty'),
  body('description').optional().trim(),
  body('event_date').optional().isDate().withMessage('Invalid date (YYYY-MM-DD)'),
  body('location').optional().trim(),
  body('cover_storage_key').optional().trim(),
  body('expires_at').optional().isISO8601().withMessage('Invalid expires_at (ISO 8601)'),
], async (req, res) => {
  if (!validate(req, res)) return;

  try {
    const event = await Event.findOne({
      where: { id: req.params.id, organizer_id: req.user.id, is_active: true },
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found or not authorized' });
    }

    const { title, description, event_date, location, cover_storage_key, expires_at } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (event_date !== undefined) updates.event_date = event_date;
    if (location !== undefined) updates.location = location;
    if (cover_storage_key !== undefined) updates.cover_storage_key = cover_storage_key;
    if (expires_at !== undefined) updates.expires_at = expires_at;

    await event.update(updates);
    await event.reload();

    res.json({ event });
  } catch (err) {
    console.error('Update event error:', err);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// POST /events/:id/cover-photo-url — Get presigned URL to upload event cover photo (organizer only)
router.post('/:id/cover-photo-url', authenticate, requireRole('organizer'), async (req, res) => {
  try {
    const event = await Event.findOne({
      where: { id: req.params.id, organizer_id: req.user.id, is_active: true },
    });
    if (!event) return res.status(404).json({ error: 'Event not found or not authorized' });

    const { filename, mime_type } = req.body;
    const ext = (filename || 'cover').split('.').pop() || 'jpg';
    const storageKey = `events/${event.id}/cover/${Date.now()}.${ext}`;
    const uploadUrl = await getUploadUrl(storageKey, mime_type || 'image/jpeg');
    res.json({ upload_url: uploadUrl, storage_key: storageKey });
  } catch (err) {
    console.error('Cover photo URL error:', err);
    res.status(500).json({ error: 'Failed to generate upload URL', detail: err.message });
  }
});

// DELETE /events/:id — Deactivate event (organizer only)
router.delete('/:id', authenticate, requireRole('organizer'), async (req, res) => {
  try {
    const event = await Event.findOne({
      where: { id: req.params.id, organizer_id: req.user.id, is_active: true },
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found or not authorized' });
    }

    await event.update({ is_active: false, soft_deleted_at: new Date() });
    res.json({ message: 'Event deleted. You can recover it within 10 days.', recoverable: true });
  } catch (err) {
    console.error('Delete event error:', err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// GET /events/deleted — list soft-deleted events for the organizer (within 10-day window)
router.get('/deleted', authenticate, requireRole('organizer'), async (req, res) => {
  const RECOVERY_DAYS = 10;
  try {
    const cutoff = new Date(Date.now() - RECOVERY_DAYS * 24 * 60 * 60 * 1000);
    const events = await Event.findAll({
      where: {
        organizer_id: req.user.id,
        is_active: false,
        soft_deleted_at: { [Op.ne]: null, [Op.gte]: cutoff },
      },
      order: [['soft_deleted_at', 'DESC']],
    });
    const withExpiry = events.map((e) => ({
      ...e.toJSON(),
      recoverable_until: new Date(e.soft_deleted_at.getTime() + RECOVERY_DAYS * 24 * 60 * 60 * 1000),
    }));
    res.json({ events: withExpiry, recovery_days: RECOVERY_DAYS });
  } catch (err) {
    console.error('GET /events/deleted error:', err);
    res.status(500).json({ error: 'Failed to fetch deleted events' });
  }
});

// POST /events/:id/recover — recover a soft-deleted event within 10 days
router.post('/:id/recover', authenticate, requireRole('organizer'), async (req, res) => {
  const RECOVERY_DAYS = 10;
  try {
    const event = await Event.findOne({
      where: { id: req.params.id, organizer_id: req.user.id, is_active: false, soft_deleted_at: { [Op.ne]: null } },
    });
    if (!event) return res.status(404).json({ error: 'Deleted event not found' });

    const cutoff = new Date(Date.now() - RECOVERY_DAYS * 24 * 60 * 60 * 1000);
    if (event.soft_deleted_at < cutoff) {
      return res.status(410).json({ error: 'Recovery window has expired. This event has been permanently deleted.' });
    }

    await event.update({ is_active: true, soft_deleted_at: null });
    res.json({ message: 'Event recovered successfully' });
  } catch (err) {
    console.error('Recover event error:', err);
    res.status(500).json({ error: 'Failed to recover event' });
  }
});

// POST /events/:id/add-member — Organizer adds a member by email
router.post('/:id/add-member', authenticate, requireRole('organizer'), [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('access_type').optional().isIn(['full', 'partial']).withMessage('access_type must be full or partial'),
], async (req, res) => {
  if (!validate(req, res)) return;

  try {
    const event = await Event.findOne({
      where: { id: req.params.id, organizer_id: req.user.id, is_active: true },
    });
    if (!event) return res.status(404).json({ error: 'Event not found or not authorized' });

    const inviteLink = `${process.env.FRONTEND_URL || 'https://snaplivo.in'}/join/${event.invite_token}`;
    const { email, access_type } = req.body;

    const targetUser = await User.findOne({ where: { email, is_active: true } });

    if (!targetUser) {
      // Not registered — send invite email with the event join link
      try {
        await sendEventInviteEmail(email, event.title, req.user.name, inviteLink);
      } catch (emailErr) {
        console.error('Invite email failed:', emailErr.message);
      }
      return res.json({
        status: 'invited',
        message: `${email} is not on SnapVault yet. An invite email has been sent.`,
      });
    }

    // Already a member?
    const existing = await EventMember.findOne({
      where: { event_id: event.id, user_id: targetUser.id },
    });
    if (existing) {
      return res.status(409).json({ error: 'This user is already a member of the event' });
    }

    // Add as guest member with chosen access type
    await EventMember.create({
      event_id: event.id,
      user_id: targetUser.id,
      role: 'guest',
      access_type: access_type || 'partial',
    });

    // Send notification email (non-blocking)
    sendAddedToEventEmail(targetUser.email, event.title, req.user.name).catch((err) =>
      console.error('Notification email failed:', err.message)
    );

    res.status(201).json({
      status: 'added',
      message: `${targetUser.name} has been added to the event.`,
    });
  } catch (err) {
    console.error('Add member error:', err);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// PATCH /events/:id/members/:userId — Update member access type (organizer only)
router.patch('/:id/members/:userId', authenticate, requireRole('organizer'), [
  body('access_type').isIn(['full', 'partial']).withMessage('access_type must be full or partial'),
], async (req, res) => {
  if (!validate(req, res)) return;

  try {
    const event = await Event.findOne({
      where: { id: req.params.id, organizer_id: req.user.id, is_active: true },
    });
    if (!event) return res.status(404).json({ error: 'Event not found or not authorized' });

    const member = await EventMember.findOne({
      where: { event_id: event.id, user_id: req.params.userId },
    });
    if (!member) return res.status(404).json({ error: 'Member not found' });
    if (member.role === 'organizer') return res.status(400).json({ error: 'Cannot change organizer access type' });

    await member.update({ access_type: req.body.access_type });
    res.json({ message: 'Access type updated', access_type: req.body.access_type });
  } catch (err) {
    console.error('Update member error:', err);
    res.status(500).json({ error: 'Failed to update member' });
  }
});

// DELETE /events/:id/members/:userId — Remove member from event (organizer only)
router.delete('/:id/members/:userId', authenticate, requireRole('organizer'), async (req, res) => {
  try {
    const event = await Event.findOne({
      where: { id: req.params.id, organizer_id: req.user.id, is_active: true },
    });
    if (!event) return res.status(404).json({ error: 'Event not found or not authorized' });

    const member = await EventMember.findOne({
      where: { event_id: event.id, user_id: req.params.userId },
    });
    if (!member) return res.status(404).json({ error: 'Member not found' });
    if (member.role === 'organizer') return res.status(400).json({ error: 'Cannot remove organizer from event' });

    await member.destroy();
    res.json({ message: 'Member removed from event' });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// GET /events/:id/members — List members (organizer only)
router.get('/:id/members', authenticate, requireRole('organizer'), async (req, res) => {
  try {
    const event = await Event.findOne({
      where: { id: req.params.id, organizer_id: req.user.id, is_active: true },
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found or not authorized' });
    }

    const members = await EventMember.findAll({
      where: { event_id: event.id },
      include: [{ model: User, attributes: ['id', 'name', 'email', 'profile_photo_url'] }],
    });

    const membersWithUrls = members.map((m) => {
      const user = m.User.toJSON();
      return {
        ...user,
        member_role: m.role,
        access_type: m.access_type,
        joined_at: m.joined_at,
      };
    });

    res.json({ members: membersWithUrls });
  } catch (err) {
    console.error('List members error:', err);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

module.exports = router;
