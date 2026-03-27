const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { User, Event, Photo } = require('../models');
const OrganizerPublicProfile = require('../models/OrganizerPublicProfile');
const OrganizerPageMedia = require('../models/OrganizerPageMedia');
const { getUploadUrl, getDownloadUrl, deleteFile, presignStoredUrl } = require('../services/s3Service');

// ── Middleware: paid-plan only ────────────────────────────────────────────────
function requirePaidPlan(req, res, next) {
  if (req.user.subscription_plan === 'free') {
    return res.status(403).json({
      error: 'Public page requires a paid plan. Upgrade to create your page.',
    });
  }
  next();
}

// ── Helper: presign all media items ──────────────────────────────────────────
async function presignMedia(mediaRows) {
  return Promise.all(
    mediaRows.map(async (m) => {
      let url = null;
      try { url = await getDownloadUrl(m.storage_key, 3600); } catch (_) {}
      return {
        id: m.id,
        media_type: m.media_type,
        url,
        order_index: m.order_index,
        file_size_bytes: Number(m.file_size_bytes),
      };
    })
  );
}

// ── GET /organizers/me — fetch own profile (upsert blank if missing) ──────────
// NOTE: /me routes MUST be registered before /:slug to prevent 'me' matching as a slug
router.get('/me', authenticate, requireRole('organizer'), requirePaidPlan, async (req, res) => {
  try {
    let profile = await OrganizerPublicProfile.findOne({ where: { organizer_id: req.user.id } });

    if (!profile) {
      const rawSlug = (req.user.name || 'organizer')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 80);

      let slug = rawSlug;
      let suffix = 1;
      while (await OrganizerPublicProfile.findOne({ where: { slug } })) {
        slug = `${rawSlug}-${suffix++}`;
      }

      profile = await OrganizerPublicProfile.create({
        organizer_id: req.user.id,
        slug,
        is_published: false,
      });
    }

    const mediaRows = await OrganizerPageMedia.findAll({
      where: { profile_id: profile.id },
      order: [['order_index', 'ASC'], ['created_at', 'ASC']],
    });
    const media = await presignMedia(mediaRows);

    res.json({ ...profile.toJSON(), media });
  } catch (err) {
    console.error('[Organizers] GET /me error:', err.message);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// ── POST /organizers/me — upsert profile fields ───────────────────────────────
router.post('/me', authenticate, requireRole('organizer'), requirePaidPlan, async (req, res) => {
  try {
    const { slug, headline, bio, template, social_instagram, social_website, is_published } = req.body;

    let profile = await OrganizerPublicProfile.findOne({ where: { organizer_id: req.user.id } });

    if (slug) {
      const existing = await OrganizerPublicProfile.findOne({
        where: { slug, organizer_id: { [Op.ne]: req.user.id } },
      });
      if (existing) return res.status(409).json({ error: 'Slug already taken. Try a different one.' });
    }

    if (!profile) {
      const finalSlug = slug || (req.user.name || 'organizer')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 80);
      profile = await OrganizerPublicProfile.create({
        organizer_id: req.user.id,
        slug: finalSlug,
        headline: headline || null,
        bio: bio || null,
        template: template || 'minimal',
        social_instagram: social_instagram || null,
        social_website: social_website || null,
        is_published: is_published ?? false,
      });
    } else {
      const updates = {};
      if (slug !== undefined) updates.slug = slug;
      if (headline !== undefined) updates.headline = headline;
      if (bio !== undefined) updates.bio = bio;
      if (template !== undefined) updates.template = template;
      if (social_instagram !== undefined) updates.social_instagram = social_instagram;
      if (social_website !== undefined) updates.social_website = social_website;
      if (is_published !== undefined) updates.is_published = is_published;
      await profile.update(updates);
    }

    res.json(profile.toJSON());
  } catch (err) {
    console.error('[Organizers] POST /me error:', err.message);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

// ── POST /organizers/me/media-url — get presigned upload URL ──────────────────
router.post('/me/media-url', authenticate, requireRole('organizer'), requirePaidPlan, async (req, res) => {
  try {
    const { media_type, filename, mime_type, file_size_bytes } = req.body;

    if (!['image', 'video'].includes(media_type)) {
      return res.status(400).json({ error: 'Invalid media_type' });
    }
    if (!filename || !mime_type || !file_size_bytes) {
      return res.status(400).json({ error: 'filename, mime_type and file_size_bytes are required' });
    }
    if (media_type === 'video' && file_size_bytes > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'Video must be under 10 MB' });
    }

    const profile = await OrganizerPublicProfile.findOne({ where: { organizer_id: req.user.id } });
    if (!profile) return res.status(400).json({ error: 'Create your profile first' });

    const imageCount = await OrganizerPageMedia.count({ where: { profile_id: profile.id, media_type: 'image' } });
    const videoCount = await OrganizerPageMedia.count({ where: { profile_id: profile.id, media_type: 'video' } });

    if (media_type === 'image' && imageCount >= 10) {
      return res.status(400).json({ error: 'Maximum 10 images reached' });
    }
    if (media_type === 'video' && videoCount >= 3) {
      return res.status(400).json({ error: 'Maximum 3 videos reached' });
    }

    const ext = filename.split('.').pop() || (media_type === 'image' ? 'jpg' : 'mp4');
    const storageKey = `organizers/${req.user.id}/${media_type}s/${Date.now()}.${ext}`;
    const uploadUrl = await getUploadUrl(storageKey, mime_type);

    const maxOrder = await OrganizerPageMedia.max('order_index', { where: { profile_id: profile.id } });
    const orderIndex = (maxOrder != null ? maxOrder : -1) + 1;

    const media = await OrganizerPageMedia.create({
      profile_id: profile.id,
      organizer_id: req.user.id,
      media_type,
      storage_key: storageKey,
      file_size_bytes: 0,
      order_index: orderIndex,
    });

    res.json({ upload_url: uploadUrl, media_id: media.id, storage_key: storageKey });
  } catch (err) {
    console.error('[Organizers] POST /me/media-url error:', err.message);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// ── POST /organizers/me/media/:id/confirm ─────────────────────────────────────
router.post('/me/media/:id/confirm', authenticate, async (req, res) => {
  try {
    const media = await OrganizerPageMedia.findOne({
      where: { id: req.params.id, organizer_id: req.user.id },
    });
    if (!media) return res.status(404).json({ error: 'Media not found' });

    const { file_size_bytes } = req.body;
    if (file_size_bytes && file_size_bytes > 0) {
      await media.update({ file_size_bytes });
      await User.increment('storage_consumed_bytes', {
        by: file_size_bytes,
        where: { id: req.user.id },
      });
    }

    let url = null;
    try { url = await getDownloadUrl(media.storage_key, 3600); } catch (_) {}

    res.json({ id: media.id, media_type: media.media_type, url, order_index: media.order_index });
  } catch (err) {
    console.error('[Organizers] POST /me/media/:id/confirm error:', err.message);
    res.status(500).json({ error: 'Failed to confirm media' });
  }
});

// ── DELETE /organizers/me/media/:id ──────────────────────────────────────────
router.delete('/me/media/:id', authenticate, async (req, res) => {
  try {
    const media = await OrganizerPageMedia.findOne({
      where: { id: req.params.id, organizer_id: req.user.id },
    });
    if (!media) return res.status(404).json({ error: 'Media not found' });

    if (media.file_size_bytes > 0) {
      await User.decrement('storage_consumed_bytes', {
        by: Number(media.file_size_bytes),
        where: { id: req.user.id },
      });
    }

    await deleteFile(media.storage_key);
    await media.destroy();

    res.json({ success: true });
  } catch (err) {
    console.error('[Organizers] DELETE /me/media/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete media' });
  }
});

// ── PATCH /organizers/me/media/order ─────────────────────────────────────────
router.patch('/me/media/order', authenticate, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });

    await Promise.all(
      items.map(({ id, order_index }) =>
        OrganizerPageMedia.update(
          { order_index },
          { where: { id, organizer_id: req.user.id } }
        )
      )
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[Organizers] PATCH /me/media/order error:', err.message);
    res.status(500).json({ error: 'Failed to reorder media' });
  }
});

// ── GET /organizers/:slug — PUBLIC (registered last to avoid shadowing /me) ───
router.get('/:slug', async (req, res) => {
  try {
    const profile = await OrganizerPublicProfile.findOne({
      where: { slug: req.params.slug, is_published: true },
    });
    if (!profile) return res.status(404).json({ error: 'Page not found' });

    const organizer = await User.findByPk(profile.organizer_id, {
      attributes: ['id', 'name', 'email', 'profile_photo_url'],
    });
    if (!organizer) return res.status(404).json({ error: 'Page not found' });

    let profilePhotoUrl = null;
    if (organizer.profile_photo_url) {
      try { profilePhotoUrl = await presignStoredUrl(organizer.profile_photo_url, 3600); } catch (_) {}
    }

    const events = await Event.findAll({
      where: { organizer_id: profile.organizer_id, is_active: true, soft_deleted_at: null },
      attributes: ['id', 'title', 'cover_storage_key', 'event_date'],
      order: [['created_at', 'DESC']],
    });

    const eventData = await Promise.all(events.map(async (ev) => {
      let coverPhotoUrl = null;
      if (ev.cover_storage_key) {
        try { coverPhotoUrl = await getDownloadUrl(ev.cover_storage_key, 3600); } catch (_) {}
      }
      const photoCount = await Photo.count({
        where: { event_id: ev.id, status: 'uploaded', soft_deleted_at: null },
      });
      return {
        id: ev.id,
        title: ev.title,
        cover_photo_url: coverPhotoUrl,
        event_date: ev.event_date,
        photo_count: photoCount,
      };
    }));

    const totalPhotos = eventData.reduce((sum, e) => sum + e.photo_count, 0);

    const mediaRows = await OrganizerPageMedia.findAll({
      where: { profile_id: profile.id },
      order: [['order_index', 'ASC'], ['created_at', 'ASC']],
    });
    const media = await presignMedia(mediaRows);

    res.json({
      organizer_id: organizer.id,
      name: organizer.name,
      email: organizer.email,
      profile_photo_url: profilePhotoUrl,
      slug: profile.slug,
      headline: profile.headline,
      bio: profile.bio,
      template: profile.template,
      social_instagram: profile.social_instagram,
      social_website: profile.social_website,
      stats: { total_events: events.length, total_photos: totalPhotos },
      media,
      events: eventData,
    });
  } catch (err) {
    console.error('[Organizers] GET /:slug error:', err.message);
    res.status(500).json({ error: 'Failed to load page' });
  }
});

module.exports = router;
