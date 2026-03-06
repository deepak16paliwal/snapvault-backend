const express = require('express');
const { body, validationResult } = require('express-validator');
const { randomUUID } = require('crypto');
const path = require('path');
const multer = require('multer');
const router = express.Router();

const { Photo, PhotoFace, FaceRejection, Event, EventMember, User } = require('../models');
const { authenticate } = require('../middleware/authMiddleware');
const { getUploadUrl, getDownloadUrl, generateThumbnail, generateWatermarkedThumbnail, deleteFile } = require('../services/s3Service');
const rekognitionService = require('../services/rekognitionService');
const { sendNotification } = require('../services/notificationService');
const { checkQuota } = require('../services/quotaService');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp'];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

// Multer: in-memory storage for face-search endpoint (5MB max)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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

// Helper: build photo response with presigned URLs (reused in multiple endpoints)
async function buildPhotoResponse(p) {
  const [photoUrl, thumbnailUrl, thumbnailWmUrl] = await Promise.all([
    getDownloadUrl(p.s3_key),
    p.thumbnail_key ? getDownloadUrl(p.thumbnail_key) : null,
    p.thumbnail_wm_key ? getDownloadUrl(p.thumbnail_wm_key) : null,
  ]);
  return {
    id: p.id,
    event_id: p.event_id,
    original_filename: p.original_filename,
    file_size: p.file_size,
    mime_type: p.mime_type,
    photo_url: photoUrl,
    thumbnail_url: thumbnailUrl,
    thumbnail_wm_url: thumbnailWmUrl,
    uploader: p.uploader,
    created_at: p.created_at,
    is_hidden: p.is_hidden ?? false,
    is_pinned: p.is_pinned ?? false,
    is_highlighted: p.is_highlighted ?? false,
  };
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

    // Check upload quota against subscription plan
    const quota = await checkQuota(req.user, mime_type);
    if (!quota.allowed) return res.status(402).json({ error: quota.reason });

    // Build S3 key
    const ext = path.extname(filename).toLowerCase() || '.jpg';
    const uuid = randomUUID();
    const s3Key = `events/${event_id}/photos/${uuid}${ext}`;
    const thumbnailKey = `events/${event_id}/thumbnails/${uuid}.jpg`;

    // Create pending photo record — thumbnail_wm_key is set only after successful generation
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

  const { photo_id, stored_size_bytes } = req.body;

  try {
    const photo = await Photo.findOne({
      where: { id: photo_id, uploader_id: req.user.id, status: 'pending' },
    });

    if (!photo) return res.status(404).json({ error: 'Photo not found or already confirmed' });

    const updateData = { status: 'uploaded' };
    if (stored_size_bytes) updateData.stored_size_bytes = stored_size_bytes;
    await photo.update(updateData);

    // Notify all event members (except uploader) about new photo — fire-and-forget
    setImmediate(async () => {
      try {
        const event = await Event.findByPk(photo.event_id);
        const [uploaderUser, members] = await Promise.all([
          User.findByPk(req.user.id, { attributes: ['name'] }),
          EventMember.findAll({ where: { event_id: photo.event_id }, attributes: ['user_id'] }),
        ]);
        const uploaderName = uploaderUser?.name || 'Organizer';
        for (const m of members) {
          if (m.user_id === req.user.id) continue; // skip the uploader
          await sendNotification({
            userId: m.user_id,
            type: 'new_photo',
            title: event ? event.name : 'New Photo',
            body: `${uploaderName} added a new photo to the event.`,
            data: { event_id: photo.event_id, screen: 'gallery' },
          });
        }
      } catch (e) { console.error('[Notif] new_photo error:', e.message); }
    });

    // Generate thumbnail async — don't block response
    setImmediate(async () => {
      try {
        await generateThumbnail(photo.s3_key, photo.thumbnail_key);
      } catch (thumbErr) {
        console.error('Thumbnail generation failed:', thumbErr.message);
      }

      // Generate watermarked thumbnail and update DB only if successful
      try {
        const wmKey = photo.thumbnail_key.replace('/thumbnails/', '/thumbnails-wm/');
        await generateWatermarkedThumbnail(photo.thumbnail_key, wmKey);
        await photo.update({ thumbnail_wm_key: wmKey });
      } catch (wmErr) {
        console.error('Watermark generation failed:', wmErr.message);
      }

      // Face indexing — runs after thumbnail attempt regardless
      try {
        const faces = await rekognitionService.indexFaces(
          process.env.AWS_S3_BUCKET,
          photo.s3_key,
          String(photo.id)
        );
        if (faces.length > 0) {
          await PhotoFace.bulkCreate(
            faces.map((f) => ({
              photo_id: photo.id,
              rekognition_face_id: f.faceId,
              confidence: f.confidence,
            }))
          );
          await photo.update({ face_index_status: 'indexed', face_indexed_at: new Date() });
          console.log(`[Rekognition] Photo ${photo.id}: indexed ${faces.length} face(s)`);
          // Notify organizer that face indexing is complete for this photo
          try {
            const event = await Event.findByPk(photo.event_id);
            const organizer = await EventMember.findOne({
              where: { event_id: photo.event_id, role: 'organizer' },
            });
            if (organizer && event) {
              await sendNotification({
                userId: organizer.user_id,
                type: 'face_indexed',
                title: 'Photos Indexed',
                body: `${faces.length} face(s) indexed in "${event.name}". Ready for attendee face scan.`,
                data: { event_id: photo.event_id, screen: 'gallery' },
              });
            }
          } catch (ne) { console.error('[Notif] face_indexed error:', ne.message); }
        } else {
          await photo.update({ face_index_status: 'no_faces' });
          console.log(`[Rekognition] Photo ${photo.id}: no faces detected`);
        }
      } catch (faceErr) {
        console.error(`[Rekognition] Photo ${photo.id} indexing failed:`, faceErr.message);
        await photo.update({ face_index_status: 'failed' }).catch(() => {});
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

// POST /photos/face-search
// Search for photos matching a selfie within a specific event
router.post('/face-search', authenticate, upload.single('image'), [
  body('event_id').isInt({ min: 1 }).withMessage('Valid event_id required'),
], async (req, res) => {
  if (!validate(req, res)) return;

  if (!req.file) {
    return res.status(400).json({ error: 'Image file required' });
  }

  const eventId = parseInt(req.body.event_id);

  try {
    // Verify event and membership
    const event = await Event.findOne({ where: { id: eventId, is_active: true } });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const membership = await EventMember.findOne({ where: { event_id: eventId, user_id: req.user.id } });
    if (!membership) return res.status(403).json({ error: 'You are not a member of this event' });

    // Enforce 2-scan limit for non-organizers
    const SCAN_LIMIT = 2;
    if (membership.role !== 'organizer' && membership.face_scan_count >= SCAN_LIMIT) {
      return res.status(429).json({
        error: `Scan limit reached. Each member can only scan ${SCAN_LIMIT} times per event.`,
        scans_used: membership.face_scan_count,
        scans_remaining: 0,
      });
    }

    // Count the scan BEFORE calling Rekognition — AWS charges per API call regardless of result
    if (membership.role !== 'organizer') {
      try {
        await membership.increment('face_scan_count');
        console.log(`[FaceScan] user ${req.user.id} event ${eventId}: face_scan_count incremented`);
      } catch (incErr) {
        console.error(`[FaceScan] Failed to increment face_scan_count for user ${req.user.id}:`, incErr.message);
        // Continue — don't fail the face search just because the count update failed
      }
    }
    const usedCount = membership.face_scan_count + (membership.role !== 'organizer' ? 1 : 0);
    const scansRemaining = membership.role !== 'organizer' ? Math.max(0, SCAN_LIMIT - usedCount) : null;

    // Search Rekognition collection with the selfie
    const matches = await rekognitionService.searchFacesByImage(req.file.buffer);

    if (matches.length === 0) {
      return res.status(400).json({
        error: 'No face detected in the image or no matching photos found',
        scans_remaining: scansRemaining,
      });
    }

    const matchedFaceIds = matches.map((m) => m.faceId);

    // Find photos in this event that contain the matched faces
    const photoFaces = await PhotoFace.findAll({
      where: { rekognition_face_id: matchedFaceIds },
      include: [{
        model: Photo,
        where: { event_id: eventId, status: 'uploaded' },
        include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }],
      }],
    });

    // Deduplicate photos
    const uniquePhotos = [];
    const seenIds = new Set();
    for (const pf of photoFaces) {
      if (!seenIds.has(pf.Photo.id)) {
        seenIds.add(pf.Photo.id);
        uniquePhotos.push(pf.Photo);
      }
    }

    // Filter out photos this user has already rejected as "Not Me"
    const rejections = await FaceRejection.findAll({
      where: { user_id: req.user.id, photo_id: uniquePhotos.map((p) => p.id) },
      attributes: ['photo_id'],
    });
    const rejectedIds = new Set(rejections.map((r) => r.photo_id));
    const filteredPhotos = uniquePhotos.filter((p) => !rejectedIds.has(p.id));

    // Generate presigned URLs
    const photosWithUrls = await Promise.all(filteredPhotos.map(buildPhotoResponse));

    res.json({ photos: photosWithUrls, scans_used: usedCount, scans_remaining: scansRemaining });
  } catch (err) {
    console.error('Face search error:', err);
    res.status(500).json({ error: 'Face search failed' });
  }
});

// GET /photos/event/:event_id
// List all uploaded photos for an event (members only)
router.get('/event/:event_id', authenticate, async (req, res) => {
  const eventId = parseInt(req.params.event_id);

  try {
    const event = await Event.findOne({ where: { id: eventId, is_active: true } });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const membership = await EventMember.findOne({ where: { event_id: eventId, user_id: req.user.id } });
    if (!membership) return res.status(403).json({ error: 'You are not a member of this event' });

    // Partial-access members can only find their own photos via face scan
    if (membership.access_type === 'partial') {
      return res.status(403).json({ error: 'Use Face Scan to find your photos in this event.' });
    }

    const isOrganizer = membership.role === 'organizer';

    // Organizers see all photos (including hidden); guests only see non-hidden
    const where = { event_id: eventId, status: 'uploaded' };
    if (!isOrganizer) where.is_hidden = false;

    const photos = await Photo.findAll({
      where,
      include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }],
      order: [
        ['is_pinned', 'DESC'],
        ['is_highlighted', 'DESC'],
        ['created_at', 'DESC'],
      ],
    });

    const photosWithUrls = await Promise.all(photos.map(buildPhotoResponse));

    res.json({ photos: photosWithUrls, is_organizer: isOrganizer });
  } catch (err) {
    console.error('List photos error:', err);
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});

// PATCH /photos/:id/moderate
// Organizer-only: hide/pin/highlight a photo
router.patch('/:id/moderate', authenticate, async (req, res) => {
  try {
    const photo = await Photo.findByPk(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });

    const isOrganizer = await EventMember.findOne({
      where: { event_id: photo.event_id, user_id: req.user.id, role: 'organizer' },
    });
    if (!isOrganizer) return res.status(403).json({ error: 'Only organizers can moderate photos' });

    const updates = {};
    if (typeof req.body.is_hidden === 'boolean') updates.is_hidden = req.body.is_hidden;
    if (typeof req.body.is_pinned === 'boolean') updates.is_pinned = req.body.is_pinned;
    if (typeof req.body.is_highlighted === 'boolean') updates.is_highlighted = req.body.is_highlighted;

    await photo.update(updates);

    res.json({ photo: { id: photo.id, ...updates } });
  } catch (err) {
    console.error('Moderate photo error:', err);
    res.status(500).json({ error: 'Failed to moderate photo' });
  }
});

// POST /photos/:id/reject-face
// Guest marks a photo as "Not Me" — excludes it from their future face search results
router.post('/:id/reject-face', authenticate, async (req, res) => {
  try {
    const photo = await Photo.findByPk(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    const member = await isMember(photo.event_id, req.user.id);
    if (!member) return res.status(403).json({ error: 'Not a member of this event' });
    await FaceRejection.findOrCreate({ where: { user_id: req.user.id, photo_id: photo.id } });
    res.json({ message: 'Photo rejected from your face search results' });
  } catch (err) {
    console.error('Face rejection error:', err);
    res.status(500).json({ error: 'Failed to reject photo' });
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

    // Delete Rekognition faces before removing from DB
    const faces = await PhotoFace.findAll({ where: { photo_id: photo.id } });
    if (faces.length > 0) {
      await rekognitionService.deleteFaces(faces.map((f) => f.rekognition_face_id));
    }

    // Delete from S3
    await deleteFile(photo.s3_key);
    if (photo.thumbnail_key) await deleteFile(photo.thumbnail_key);

    // Delete from DB (CASCADE deletes photo_faces rows)
    await photo.destroy();

    res.json({ message: 'Photo deleted successfully' });
  } catch (err) {
    console.error('Delete photo error:', err);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

module.exports = router;
