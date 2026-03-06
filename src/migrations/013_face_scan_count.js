const sequelize = require('../config/database');

async function up() {
  const [[col]] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'event_members'
      AND COLUMN_NAME = 'face_scan_count'
  `);
  if (!col) {
    await sequelize.query(`
      ALTER TABLE event_members
        ADD COLUMN face_scan_count INT NOT NULL DEFAULT 0
    `);
    console.log('[Migration 013] event_members.face_scan_count added');
  } else {
    console.log('[Migration 013] event_members.face_scan_count already exists');
  }
}

module.exports = { up };
