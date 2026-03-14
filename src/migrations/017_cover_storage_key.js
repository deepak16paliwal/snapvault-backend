const sequelize = require('../config/database');

async function up() {
  const [[col]] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events'
      AND COLUMN_NAME = 'cover_storage_key'
  `);
  if (!col) {
    await sequelize.query(`ALTER TABLE events ADD COLUMN cover_storage_key VARCHAR(512) NULL`);
  }
  console.log('[Migration 017] events.cover_storage_key ready');
}

module.exports = { up };
