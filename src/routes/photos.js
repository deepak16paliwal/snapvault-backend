const express = require('express');
const { body, validationResult } = require('express-validator');
const path = require('path');
const multer = require('multer');
const router = express.Router();

const { Photo, PhotoFace, FaceRejection, Event, EventMember, User, UserPhotoMatch } = require('../models');
const { Op } = require('sequelize');
const { authenticate } = require('../middleware/authMiddleware');
const { getUploadUrl, getDownloadUrl, generateThumbnail, deleteFile, downloadBuffer, computeImageHash } = require('../services/s3Service');
const archiver = require('archiver');
const rekognitionService = require('../services/rekognitionService');
const { sendNotification } = require('../services/notificationService');
const { checkQuota, getPlanLimits } = require('../services/quotaService');

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/heic', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/mov',
];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;  // 20 MB
const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500 MB

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
    is_hidden: p.is_hidden ?? false,
    is_pinned: p.is_pinned ?? false,
    is_highlighted: p.is_highlighted ?? false,
  };
}

// POST /photos/signed-url
// Get a presigned S3 URL to upload a photo or video directly from the client
router.post('/signed-url', authenticate, [
  body('event_id').isInt({ min: 1 }).withMessage('Valid event_id required'),
  body('filename').trim().notEmpty().withMessage('filename required'),
  body('mime_type').isIn(ALLOWED_MIME_TYPES).withMessage('Unsupported file type'),
  body('file_size').isInt({ min: 1 }).withMessage('file_size required'),
], async (req, res) => {
  if (!validate(req, res)) return;

  const { event_id, filename, mime_type, file_size } = req.body;
  const isVideo = mime_type.startsWith('video/');
  const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
  if (file_size > maxSize) {
    const limitLabel = isVideo ? '500 MB' : '20 MB';
    return res.status(400).json({ error: `Max file size for ${isVideo ? 'video' : 'image'} is ${limitLabel}` });
  }

  try {
    // Verify event is active and user is a member
    const event = await Event.findOne({ where: { id: event_id, is_active: true } });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const member = await isMember(event_id, req.user.id);
    if (!member) return res.status(403).json({ error: 'You are not a member of this event' });

    // Check upload quota against subscription plan
    const quota = await checkQuota(req.user, mime_type);
    if (!quota.allowed) return res.status(402).json({ error: quota.reason });

    // Create pending photo record first to get photo_id for deterministic key
    const photo = await Photo.create({
      event_id,
      uploader_id: req.user.id,
      original_filename: filename,
      s3_key: 'pending',  // placeholder — updated immediately below
      file_size,
      mime_type,
      status: 'pending',
    });

    // Build deterministic R2 keys using photo_id
    const ext = path.extname(filename).toLowerCase() || (isVideo ? '.mp4' : '.jpg');
    const s3Key = `events/${event_id}/photos/${photo.id}${ext}`;
    const thumbnailKey = isVideo ? null : `events/${event_id}/thumbnails/${photo.id}.webp`;
    await photo.update({ s3_key: s3Key, thumbnail_key: thumbnailKey });

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

    // Increment cumulative storage counter — never decremented (storage is non-refundable)
    if (photo.file_size) {
      await User.increment('storage_consumed_bytes', { by: photo.file_size, where: { id: req.user.id } });
    }

    // Notify all event members (except uploader) about new photo — fire-and-forget
    setImmediate(async () => {
      try {
        const event = await Event.findByPk(photo.event_id);
        const [uploaderUser, membersWithScan] = await Promise.all([
          User.findByPk(req.user.id, { attributes: ['name'] }),
          EventMember.findAll({ where: { event_id: photo.event_id }, attributes: ['user_id', 'face_scan_count'] }),
        ]);
        const uploaderName = uploaderUser?.name || 'Someone';
        const eventTitle = event ? event.title : 'the event';
        for (const m of membersWithScan) {
          if (m.user_id === req.user.id) continue; // skip the uploader
          const hasScanned = (m.face_scan_count || 0) > 0;
          await sendNotification({
            userId: m.user_id,
            type: hasScanned ? 'rescan' : 'new_photo',
            title: hasScanned ? 'New Photos Added' : eventTitle,
            body: hasScanned
              ? `New photos added to "${eventTitle}". Re-scan to find more of yours.`
              : `${uploaderName} added a new photo to ${eventTitle}.`,
            data: { event_id: photo.event_id, screen: hasScanned ? 'face_scan' : 'gallery' },
          });
        }
      } catch (e) { console.error('[Notif] new_photo error:', e.message); }
    });

    // Generate thumbnail + hash + face index async — don't block response
    setImmediate(async () => {
      if (photo.thumbnail_key) {
        try {
          await generateThumbnail(photo.s3_key, photo.thumbnail_key);
        } catch (thumbErr) {
          console.error('Thumbnail generation failed:', thumbErr.message);
        }
      }

      // Face indexing — images only
      if (photo.mime_type && photo.mime_type.startsWith('video/')) return;

      // Download buffer once — reused for hash, dedup, and face indexing
      let buffer = null;
      try {
        buffer = await downloadBuffer(photo.s3_key);
      } catch (dlErr) {
        console.error(`[FaceIndex] Failed to download photo ${photo.id} from R2:`, dlErr.message);
        await photo.update({ face_index_status: 'failed' }).catch(() => {});
        return;
      }

      // Compute perceptual hash and check for duplicates before calling Rekognition
      try {
        const imageHash = await computeImageHash(buffer);
        await photo.update({ image_hash: imageHash });

        const duplicate = await Photo.findOne({
          where: {
            event_id: photo.event_id,
            image_hash: imageHash,
            id: { [Op.ne]: photo.id },
            status: 'uploaded',
          },
        });
        if (duplicate) {
          await photo.update({ face_index_status: 'no_faces' });
          console.log(`[Dedup] Photo ${photo.id} is a duplicate of ${duplicate.id} — skipping face index`);
          return;
        }
      } catch (hashErr) {
        console.error(`[Dedup] Hash error for photo ${photo.id}:`, hashErr.message);
        // Continue with face indexing even if hashing fails
      }

      const collectionId = `event_${photo.event_id}`;
      try {
        const faces = await rekognitionService.indexFaces(
          collectionId,
          buffer,
          String(photo.id)
        );
        if (faces.length > 0) {
          await PhotoFace.bulkCreate(
            faces.map((f) => ({
              photo_id: photo.id,
              event_id: photo.event_id,
              rekognition_face_id: f.faceId,
              bounding_box: f.boundingBox || null,
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
                body: `${faces.length} face(s) indexed in "${event.title}". Ready for attendee face scan.`,
                data: { event_id: photo.event_id, screen: 'gallery' },
              });
            }
          } catch (ne) { console.error('[Notif] face_indexed error:', ne.message); }

          // Auto-match: find members with stored face profiles and notify if overlap
          try {
            const newFaceIds = faces.map((f) => f.faceId);
            const membersWithProfiles = await EventMember.findAll({
              where: { event_id: photo.event_id, matched_face_ids: { [Op.ne]: null } },
            });
            for (const m of membersWithProfiles) {
              const overlap = (m.matched_face_ids || []).some((id) => newFaceIds.includes(id));
              if (!overlap) continue;
              await UserPhotoMatch.findOrCreate({
                where: { user_id: m.user_id, event_id: photo.event_id, photo_id: photo.id },
              });
              const evt = await Event.findByPk(photo.event_id);
              sendNotification({
                userId: m.user_id,
                type: 'new_photo_match',
                title: 'You\'re in a new photo!',
                body: `A new photo of you was added to "${evt?.title || 'the event'}". Tap to view.`,
                data: { event_id: String(photo.event_id), screen: 'my_photos' },
              }).catch(() => {});
            }
          } catch (amErr) { console.error('[AutoMatch] error:', amErr.message); }
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

    // Enforce plan-based scan limit — applies to everyone including organizers
    const planLimits = await getPlanLimits(req.user.subscription_plan || 'free');
    const SCAN_LIMIT = planLimits?.max_face_scans_per_event ?? 1;

    if (membership.face_scan_count >= SCAN_LIMIT) {
      return res.status(429).json({
        error: `Scan limit reached. Your ${planLimits?.name || 'current'} plan allows ${SCAN_LIMIT} scan${SCAN_LIMIT !== 1 ? 's' : ''} per event. Upgrade to scan more.`,
        scans_used: membership.face_scan_count,
        scans_remaining: 0,
        scan_limit: SCAN_LIMIT,
      });
    }

    // Count the scan BEFORE calling Rekognition — AWS charges per API call regardless of result
    try {
      await membership.increment('face_scan_count');
      console.log(`[FaceScan] user ${req.user.id} event ${eventId}: face_scan_count incremented (plan limit: ${SCAN_LIMIT})`);
    } catch (incErr) {
      console.error(`[FaceScan] Failed to increment face_scan_count for user ${req.user.id}:`, incErr.message);
    }
    const usedCount = membership.face_scan_count + 1;
    const scansRemaining = Math.max(0, SCAN_LIMIT - usedCount);

    // Search per-event Rekognition collection with the selfie
    const matches = await rekognitionService.searchFacesByImage(`event_${eventId}`, req.file.buffer);

    if (matches.length === 0) {
      return res.status(400).json({
        error: 'No face detected in the image or no matching photos found',
        scans_remaining: scansRemaining,
        scan_limit: SCAN_LIMIT,
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

    // Persist matched face IDs (union with any previous scan) and store photo matches
    const existingIds = membership.matched_face_ids || [];
    const allFaceIds = [...new Set([...existingIds, ...matchedFaceIds])];
    await membership.update({ matched_face_ids: allFaceIds });
    if (filteredPhotos.length > 0) {
      await Promise.all(
        filteredPhotos.map((p) =>
          UserPhotoMatch.findOrCreate({ where: { user_id: req.user.id, event_id: eventId, photo_id: p.id } })
        )
      );
    }

    // Generate presigned URLs
    const photosWithUrls = await Promise.all(filteredPhotos.map(buildPhotoResponse));

    res.json({ photos: photosWithUrls, scans_used: usedCount, scans_remaining: scansRemaining });
  } catch (err) {
    console.error('Face search error:', err);
    res.status(500).json({ error: 'Face search failed' });
  }
});

// GET /photos/my-matches/:event_id
// Return photos persistently matched to the current user in an event
router.get('/my-matches/:event_id', authenticate, async (req, res) => {
  const eventId = parseInt(req.params.event_id);
  try {
    const matches = await UserPhotoMatch.findAll({
      where: { user_id: req.user.id, event_id: eventId },
      include: [{
        model: Photo,
        where: { status: 'uploaded' },
        include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }],
      }],
    });
    const rejections = await FaceRejection.findAll({
      where: { user_id: req.user.id },
      attributes: ['photo_id'],
    });
    const rejectedIds = new Set(rejections.map((r) => r.photo_id));
    const photos = matches.map((m) => m.Photo).filter((p) => p && !rejectedIds.has(p.id));
    const photosWithUrls = await Promise.all(photos.map(buildPhotoResponse));
    res.json({ photos: photosWithUrls });
  } catch (err) {
    console.error('My matches error:', err);
    res.status(500).json({ error: 'Failed to fetch matched photos' });
  }
});

// GET /photos/event/:event_id
// List uploaded photos for an event (members only), with pagination and sort
// Query params: page (default 1), limit (default 30, max 100), sort (newest|oldest, default newest)
router.get('/event/:event_id', authenticate, async (req, res) => {
  const eventId = parseInt(req.params.event_id);
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
  const sort = req.query.sort === 'oldest' ? 'ASC' : 'DESC';
  const offset = (page - 1) * limit;

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
    // Soft-deleted photos are excluded for everyone
    const where = { event_id: eventId, status: 'uploaded', soft_deleted_at: null };
    if (!isOrganizer) where.is_hidden = false;

    const { count, rows: photos } = await Photo.findAndCountAll({
      where,
      include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }],
      order: [
        ['is_pinned', 'DESC'],
        ['is_highlighted', 'DESC'],
        ['created_at', sort],
      ],
      limit,
      offset,
    });

    const photosWithUrls = await Promise.all(photos.map(buildPhotoResponse));
    const totalPages = Math.ceil(count / limit);

    res.json({
      photos: photosWithUrls,
      is_organizer: isOrganizer,
      pagination: { page, limit, total: count, total_pages: totalPages, has_next: page < totalPages },
    });
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

    // Soft delete — keep file in R2 and record in DB, recoverable for 10 days
    await photo.update({ soft_deleted_at: new Date() });

    res.json({ message: 'Photo deleted. You can recover it within 10 days.', recoverable: true });
  } catch (err) {
    console.error('Delete photo error:', err);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

// POST /photos/:id/recover
// Organizer or uploader can recover a soft-deleted photo within 10 days
router.post('/:id/recover', authenticate, async (req, res) => {
  const RECOVERY_DAYS = 10;
  try {
    const photo = await Photo.findOne({
      where: { id: req.params.id, soft_deleted_at: { [Op.ne]: null } },
    });
    if (!photo) return res.status(404).json({ error: 'Deleted photo not found' });

    const isUploader = photo.uploader_id === req.user.id;
    const isOrganizer = await EventMember.findOne({
      where: { event_id: photo.event_id, user_id: req.user.id, role: 'organizer' },
    });
    if (!isUploader && !isOrganizer) return res.status(403).json({ error: 'Not authorized' });

    const cutoff = new Date(Date.now() - RECOVERY_DAYS * 24 * 60 * 60 * 1000);
    if (photo.soft_deleted_at < cutoff) {
      return res.status(410).json({ error: 'Recovery window has expired. This photo has been permanently deleted.' });
    }

    await photo.update({ soft_deleted_at: null });
    res.json({ message: 'Photo recovered successfully' });
  } catch (err) {
    console.error('Recover photo error:', err);
    res.status(500).json({ error: 'Failed to recover photo' });
  }
});

// GET /photos/deleted/:event_id
// Returns soft-deleted photos for an event (organizer only)
router.get('/deleted/:event_id', authenticate, async (req, res) => {
  const RECOVERY_DAYS = 10;
  try {
    const isOrganizer = await EventMember.findOne({
      where: { event_id: req.params.event_id, user_id: req.user.id, role: 'organizer' },
    });
    if (!isOrganizer) return res.status(403).json({ error: 'Organizer access required' });

    const cutoff = new Date(Date.now() - RECOVERY_DAYS * 24 * 60 * 60 * 1000);
    const photos = await Photo.findAll({
      where: {
        event_id: req.params.event_id,
        soft_deleted_at: { [Op.ne]: null, [Op.gte]: cutoff },
      },
      order: [['soft_deleted_at', 'DESC']],
    });

    const withUrls = await Promise.all(photos.map(async (p) => {
      const url = await getDownloadUrl(p.s3_key).catch(() => null);
      const thumbUrl = p.thumbnail_key ? await getDownloadUrl(p.thumbnail_key).catch(() => null) : null;
      const expiresAt = new Date(p.soft_deleted_at.getTime() + RECOVERY_DAYS * 24 * 60 * 60 * 1000);
      return { ...p.toJSON(), s3_url: url, thumbnail_url: thumbUrl, recoverable_until: expiresAt };
    }));

    res.json({ photos: withUrls, recovery_days: RECOVERY_DAYS });
  } catch (err) {
    console.error('GET /photos/deleted error:', err);
    res.status(500).json({ error: 'Failed to fetch deleted photos' });
  }
});

// GET /photos/:id/download-url
// Returns a fresh signed URL for a single photo — available to all plans (no bulk_download required).
router.get('/:id/download-url', authenticate, async (req, res) => {
  try {
    const photo = await Photo.findByPk(req.params.id);
    if (!photo || photo.status !== 'uploaded') return res.status(404).json({ error: 'Photo not found' });

    // Must be event member
    const membership = await EventMember.findOne({ where: { event_id: photo.event_id, user_id: req.user.id } });
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    const url = await getDownloadUrl(photo.s3_key, 300); // 5-minute expiry
    res.json({ url });
  } catch (err) {
    console.error('GET /photos/:id/download-url:', err);
    res.status(500).json({ error: 'Failed to generate download URL' });
  }
});

// POST /photos/download-zip
// Download a batch of photos as a ZIP. Requires bulk_download plan feature.
// Body: { photo_ids: [1, 2, ...] }
router.post('/download-zip', authenticate, [
  body('photo_ids').isArray({ min: 1, max: 100 }).withMessage('photo_ids must be a non-empty array (max 100)'),
], async (req, res) => {
  if (!validate(req, res)) return;

  try {
    const limits = await getPlanLimits(req.user.subscription_plan || 'free');
    if (!limits?.bulk_download) {
      return res.status(403).json({ error: 'Bulk download is available on Standard plan and above. Upgrade to continue.' });
    }

    const photoIds = req.body.photo_ids.map(Number).filter(Boolean);
    const photos = await Photo.findAll({
      where: { id: photoIds, status: 'uploaded' },
    });

    // Verify membership for all events referenced
    const eventIds = [...new Set(photos.map((p) => p.event_id))];
    const memberships = await EventMember.findAll({
      where: { event_id: eventIds, user_id: req.user.id },
    });
    const memberEventIds = new Set(memberships.map((m) => m.event_id));
    const accessible = photos.filter((p) => memberEventIds.has(p.event_id) && !p.is_hidden);

    if (accessible.length === 0) {
      return res.status(400).json({ error: 'No accessible photos found' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="snapvault-photos.zip"');

    const archive = archiver('zip', { zlib: { level: 1 } }); // level 1 = fast, photos already compressed
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      if (!res.headersSent) res.status(500).end();
    });
    archive.pipe(res);

    for (const photo of accessible) {
      try {
        const buffer = await downloadBuffer(photo.s3_key);
        const ext = path.extname(photo.original_filename) || '.jpg';
        archive.append(buffer, { name: `${photo.id}${ext}` });
      } catch (dlErr) {
        console.error(`Failed to fetch photo ${photo.id} for ZIP:`, dlErr.message);
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error('ZIP download error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to create ZIP' });
  }
});

module.exports = router;
