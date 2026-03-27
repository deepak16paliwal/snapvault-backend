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
const { up: runMigration14 } = require('./src/migrations/014_drop_watermark_key');
const { up: runMigration15 } = require('./src/migrations/015_user_photo_matches');
const { up: runMigration16 } = require('./src/migrations/016_event_soft_delete');
const { up: runMigration17 } = require('./src/migrations/017_cover_storage_key');
const { up: runMigration18 } = require('./src/migrations/018_photo_hash');
const { up: runMigration19 } = require('./src/migrations/019_photo_faces_event');
const { up: runMigration20 } = require('./src/migrations/020_contact_messages');
const { up: runMigration22 } = require('./src/migrations/022_subscription_plan_starter');
const { up: runMigration23 } = require('./src/migrations/023_soft_delete_photos');
const { up: runMigration24 } = require('./src/migrations/024_plan_face_scan_limit');
const { up: runMigration25 } = require('./src/migrations/025_brand_logo_connect_requests');
const { up: runMigration26 } = require('./src/migrations/026_organizer_public_profile');
const { startExpiryJob } = require('./src/jobs/eventExpiryJob');
const { startSubscriptionJob } = require('./src/jobs/subscriptionJob');

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
    await runMigration14();
    await runMigration15();
    await runMigration16();
    await runMigration17();
    await runMigration18();
    await runMigration19();
    await runMigration20();
    await runMigration22();
    await runMigration23();
    await runMigration24();
    await runMigration25();
    await runMigration26();

    // Start server
    app.listen(env.port, () => {
      console.log(`SnapVault backend running on port ${env.port}`);
      startExpiryJob();
      startSubscriptionJob();
    });
  } catch (err) {
    console.error('Startup failed:', err);
    process.exit(1);
  }
}

start();
