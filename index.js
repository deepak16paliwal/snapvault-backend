const env = require('./src/config/env');
const app = require('./src/app');
const sequelize = require('./src/config/database');
const redis = require('./src/config/redis');
const { up: runMigration } = require('./src/migrations/001_create_users');
const { up: runMigration2 } = require('./src/migrations/002_create_events');
const { up: runMigration3 } = require('./src/migrations/003_create_photos');
const { up: runMigration4 } = require('./src/migrations/004_face_indexing');
const { up: runMigration5 } = require('./src/migrations/005_photo_moderation');
const { up: runMigration6 } = require('./src/migrations/006_notifications');
const { up: runMigration7 } = require("./src/migrations/007_subscriptions");
const { up: runMigration8 } = require("./src/migrations/008_photo_sizes");
const { up: runMigration9 } = require('./src/migrations/009_face_rejections');
const { up: runMigration10 } = require('./src/migrations/010_event_expiry');
const { up: runMigration11 } = require('./src/migrations/011_member_access');
const { up: runMigration12 } = require('./src/migrations/012_watermark_thumbnail');
const { up: runMigration13 } = require('./src/migrations/013_face_scan_count');
const { ensureCollection } = require('./src/services/rekognitionService');
const { startExpiryJob } = require('./src/jobs/eventExpiryJob');
const { Op } = require('sequelize');

async function start() {
  try {
    // Connect Redis
    await redis.connect();

    // Connect MySQL
    await sequelize.authenticate();
    console.log('MySQL connected');

    // Run migrations (idempotent — CREATE TABLE IF NOT EXISTS)
    await runMigration();
    await runMigration2();
    await runMigration3();
    await runMigration4();
    await runMigration5();
    await runMigration6();
    await runMigration7();
    await runMigration8();
    await runMigration9();
    await runMigration10();
    await runMigration11();
    await runMigration12();
    await runMigration13();

    // Ensure Rekognition collection exists
    await ensureCollection();

    // Start server
    app.listen(env.port, () => {
      console.log(`SnapVault backend running on port ${env.port}`);
      startExpiryJob();
      backfillWatermarks();
    });
  } catch (err) {
    console.error('Startup failed:', err);
    process.exit(1);
  }
}

// One-time background job: generate watermarked thumbnails for photos missing them
async function backfillWatermarks() {
  try {
    const { Photo } = require('./src/models');
    const { generateWatermarkedThumbnail } = require('./src/services/s3Service');
    const photos = await Photo.findAll({
      where: {
        thumbnail_key: { [Op.ne]: null },
        thumbnail_wm_key: null,
        status: 'uploaded',
      },
    });
    if (photos.length === 0) return;
    console.log(`[WatermarkBackfill] Processing ${photos.length} photo(s)...`);
    for (const photo of photos) {
      try {
        const wmKey = photo.thumbnail_key.replace('/thumbnails/', '/thumbnails-wm/');
        await generateWatermarkedThumbnail(photo.thumbnail_key, wmKey);
        await photo.update({ thumbnail_wm_key: wmKey });
      } catch (err) {
        console.error(`[WatermarkBackfill] Failed for photo ${photo.id}:`, err.message);
      }
    }
    console.log('[WatermarkBackfill] Done');
  } catch (err) {
    console.error('[WatermarkBackfill] Error:', err.message);
  }
}

start();
