const sequelize = require('../config/database');

async function up() {
  // 1. photos.soft_deleted_at
  const [[photoCol]] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'photos'
      AND COLUMN_NAME = 'soft_deleted_at'
  `);
  if (!photoCol) {
    await sequelize.query(`ALTER TABLE photos ADD COLUMN soft_deleted_at DATETIME NULL`);
    console.log('[Migration 023] photos.soft_deleted_at added');
  } else {
    console.log('[Migration 023] photos.soft_deleted_at already exists');
  }

  // 2. users.storage_consumed_bytes — cumulative, never decremented
  const [[userCol]] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'storage_consumed_bytes'
  `);
  if (!userCol) {
    await sequelize.query(`ALTER TABLE users ADD COLUMN storage_consumed_bytes BIGINT NOT NULL DEFAULT 0`);
    // Backfill from existing uploaded photos so live data is correct
    await sequelize.query(`
      UPDATE users u
      SET u.storage_consumed_bytes = (
        SELECT COALESCE(SUM(p.file_size), 0)
        FROM photos p
        WHERE p.uploader_id = u.id AND p.status = 'uploaded'
      )
    `);
    console.log('[Migration 023] users.storage_consumed_bytes added + backfilled');
  } else {
    console.log('[Migration 023] users.storage_consumed_bytes already exists');
  }
}

module.exports = { up };
