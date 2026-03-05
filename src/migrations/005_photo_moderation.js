const sequelize = require('../config/database');

async function up() {
  // Idempotent: only add columns if they don't exist
  const [[existing]] = await sequelize.query(`
    SELECT COUNT(*) as cnt
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'photos'
      AND COLUMN_NAME = 'is_hidden'
  `);

  if (existing.cnt === 0) {
    await sequelize.query(`
      ALTER TABLE photos
        ADD COLUMN is_hidden TINYINT(1) NOT NULL DEFAULT 0,
        ADD COLUMN is_pinned TINYINT(1) NOT NULL DEFAULT 0,
        ADD COLUMN is_highlighted TINYINT(1) NOT NULL DEFAULT 0
    `);
    console.log('[Migration 005] Added moderation columns to photos');
  } else {
    console.log('[Migration 005] Moderation columns already exist, skipping');
  }
}

module.exports = { up };
