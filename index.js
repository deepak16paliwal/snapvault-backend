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
const { ensureCollection } = require('./src/services/rekognitionService');

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

    // Ensure Rekognition collection exists
    await ensureCollection();

    // Start server
    app.listen(env.port, () => {
      console.log(`SnapVault backend running on port ${env.port}`);
    });
  } catch (err) {
    console.error('Startup failed:', err);
    process.exit(1);
  }
}

start();
