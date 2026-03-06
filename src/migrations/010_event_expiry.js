const sequelize = require('../config/database');

async function up() {
  const [[col]] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events'
      AND COLUMN_NAME = 'expires_at'
  `);
  if (!col) {
    await sequelize.query(`
      ALTER TABLE events ADD COLUMN expires_at DATETIME NULL;
    `);
  }
  console.log('[Migration 010] events.expires_at ready');
}

module.exports = { up };
