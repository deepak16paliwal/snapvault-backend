const sequelize = require('../config/database');

async function up() {
  const [[col]] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'photos'
      AND COLUMN_NAME = 'image_hash'
  `);
  if (!col) {
    await sequelize.query(`ALTER TABLE photos ADD COLUMN image_hash VARCHAR(64) NULL`);
  }

  // Index for fast duplicate lookups per event
  const [[idx]] = await sequelize.query(`
    SELECT INDEX_NAME FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'photos'
      AND INDEX_NAME = 'idx_photos_event_hash'
  `);
  if (!idx) {
    await sequelize.query(`CREATE INDEX idx_photos_event_hash ON photos (event_id, image_hash)`);
  }

  console.log('[Migration 018] photos.image_hash + index ready');
}

module.exports = { up };
