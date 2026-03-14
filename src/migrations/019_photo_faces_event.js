const sequelize = require('../config/database');

async function up() {
  // Add event_id for faster face-search queries without joining photos table
  const [[eventIdCol]] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'photo_faces'
      AND COLUMN_NAME = 'event_id'
  `);
  if (!eventIdCol) {
    await sequelize.query(`ALTER TABLE photo_faces ADD COLUMN event_id INT NULL`);
  }

  // Add bounding_box to store Rekognition BoundingBox { Width, Height, Left, Top }
  const [[bboxCol]] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'photo_faces'
      AND COLUMN_NAME = 'bounding_box'
  `);
  if (!bboxCol) {
    await sequelize.query(`ALTER TABLE photo_faces ADD COLUMN bounding_box JSON NULL`);
  }

  // Add created_at timestamp
  const [[createdAtCol]] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'photo_faces'
      AND COLUMN_NAME = 'created_at'
  `);
  if (!createdAtCol) {
    await sequelize.query(`ALTER TABLE photo_faces ADD COLUMN created_at DATETIME DEFAULT NOW()`);
  }

  // Index for fast lookup by event_id
  const [[idx]] = await sequelize.query(`
    SELECT INDEX_NAME FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'photo_faces'
      AND INDEX_NAME = 'idx_photo_faces_event'
  `);
  if (!idx) {
    await sequelize.query(`CREATE INDEX idx_photo_faces_event ON photo_faces (event_id)`);
  }

  console.log('[Migration 019] photo_faces.event_id + bounding_box + created_at + index ready');
}

module.exports = { up };
