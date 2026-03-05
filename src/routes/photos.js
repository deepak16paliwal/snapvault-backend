const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const router = express.Router();

const { Photo, Event, EventMember, User } = require('../models');
const { authenticate } = require('../middleware/authMiddleware');
const { getUploadUrl, getDownloadUrl, generateThumbnail, deleteFile } = require('../services/s3Service');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp'];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return false;
  }
  return true;
}

// Check if user is a member of the event
async function isMember(eventId, userId) {
  const m = await EventMember.findOne({ where: { event_id: eventId, user_id: userId } });
  return !!m;
}

// POST /photos/signed-url
// Get a presigned S3 URL to upload a photo directly from the client
router.post('/signed-url', authenticate, [
  body('event_id').isInt({ min: 1 }).withMessage('Valid event_id required'),
  body('filename').trim().notEmpty().withMessage('filename required'),
  body('mime_type').isIn(ALLOWED_MIME_TYPES).withMessage('Unsupported file type'),
  body('file_size').isInt({ min: 1, max: MAX_FILE_SIZE }).withMessage(`Max file size is 20MB`),
], async (req, res) => {
  if (!validate(req, res)) return;

  const { event_id, filename, mime_type, file_size } = req.body;

  try {
    // Verify event is active and user is a member
    const event = await Event.findOne({ where: { id: event_id, is_active: true } });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const member = await isMember(event_id, req.user.id);
    if (!member) return res.status(403).json({ error: 'You are not a member of this event' });

    // Build S3 key
    const ext = path.extname(filename).toLowerCase() || '.jpg';
    const uuid = uuidv4();
    const s3Key = `events/${event_id}/photos/${uuid}${ext}`;
    const thumbnailKey = `events/${event_id}/thumbnails/${uuid}.jpg`;

    // Create pending photo record
    const photo = await Photo.create({
      event_id,
      uploader_id: req.user.id,
      original_filename: filename,
      s3_key: s3Key,
      thumbnail_key: thumbnailKey,
      file_size,
      mime_type,
      status: 'pending',
    });

    // Generate presigned upload URL
    const uploadUrl = await getUploadUrl(s3Key, mime_type);

    res.status(201).json({
      photo_id: photo.id,
      upload_url: uploadUrl,
      s3_key: s3Key,
    });
  } catch (err) {
    console.error('Signed URL error:', err);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// POST /photos/confirm
// Called after client finishes uploading to S3
router.post('/confirm', authenticate, [
  body('photo_id').isInt({ min: 1 }).withMessage('Valid photo_id required'),
], async (req, res) => {
  if (!validate(req, res)) return;

  const { photo_id } = req.body;

  try {
    const photo = await Photo.findOne({
      where: { id: photo_id, uploader_id: req.user.id, status: 'pending' },
    });

    if (!photo) return res.status(404).json({ error: 'Photo not found or already confirmed' });

    await photo.update({ status: 'uploaded' });

    // Generate thumbnail async — don't block response
    setImmediate(async () => {
      try {
        await generateThumbnail(photo.s3_key, photo.thumbnail_key);
        await photo.update({ thumbnail_key: photo.thumbnail_key });
      } catch (thumbErr) {
        console.error('Thumbnail generation failed:', thumbErr.message);
      }
    });

    res.json({
      photo: {
        id: photo.id,
        event_id: photo.event_id,
        original_filename: photo.original_filename,
        status: photo.status,
        created_at: photo.created_at,
      },
    });
  } catch (err) {
    console.error('Confirm photo error:', err);
    res.status(500).json({ error: 'Failed to confirm upload' });
  }
});

// GET /photos/event/:event_id
// List all uploaded photos for an event (members only)
router.get('/event/:event_id', authenticate, async (req, res) => {
  const eventId = parseInt(req.params.event_id);

  try {
    const event = await Event.findOne({ where: { id: eventId, is_active: true } });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const member = await isMember(eventId, req.user.id);
    if (!member) return res.status(403).json({ error: 'You are not a member of this event' });

    const photos = await Photo.findAll({
      where: { event_id: eventId, status: 'uploaded' },
      include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }],
      order: [['created_at', 'DESC']],
    });

    // Generate presigned download URLs for each photo
    const photosWithUrls = await Promise.all(photos.map(async (p) => {
      const [photoUrl, thumbnailUrl] = await Promise.all([
        getDownloadUrl(p.s3_key),
        p.thumbnail_key ? getDownloadUrl(p.thumbnail_key) : null,
      ]);
      return {
        id: p.id,
        event_id: p.event_id,
        original_filename: p.original_filename,
        file_size: p.file_size,
        mime_type: p.mime_type,
        photo_url: photoUrl,
        thumbnail_url: thumbnailUrl,
        uploader: p.uploader,
        created_at: p.created_at,
      };
    }));

    res.json({ photos: photosWithUrls });
  } catch (err) {
    console.error('List photos error:', err);
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});

// DELETE /photos/:id
// Uploader or event organizer can delete
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const photo = await Photo.findByPk(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });

    // Check permissions: uploader OR organizer of the event
    const isUploader = photo.uploader_id === req.user.id;
    const isOrganizer = await EventMember.findOne({
      where: { event_id: photo.event_id, user_id: req.user.id, role: 'organizer' },
    });

    if (!isUploader && !isOrganizer) {
      return res.status(403).json({ error: 'Not authorized to delete this photo' });
    }

    // Delete from S3
    await deleteFile(photo.s3_key);
    if (photo.thumbnail_key) await deleteFile(photo.thumbnail_key);

    // Delete from DB
    await photo.destroy();

    res.json({ message: 'Photo deleted successfully' });
  } catch (err) {
    console.error('Delete photo error:', err);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

module.exports = router;
