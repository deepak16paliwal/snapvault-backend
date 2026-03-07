const sequelize = require('../config/database');

async function up() {
  const [[col]] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events'
      AND COLUMN_NAME = 'soft_deleted_at'
  `);
  if (!col) {
    await sequelize.query(`ALTER TABLE events ADD COLUMN soft_deleted_at DATETIME NULL`);
  }
  console.log('[Migration 016] events.soft_deleted_at ready');
}

module.exports = { up };
