const sequelize = require('../config/database');

async function up() {
  const [[col]] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'photos'
      AND COLUMN_NAME = 'thumbnail_wm_key'
  `);
  if (col) {
    await sequelize.query(`ALTER TABLE photos DROP COLUMN thumbnail_wm_key`);
  }
  console.log('[Migration 014] thumbnail_wm_key removed');
}

module.exports = { up };
