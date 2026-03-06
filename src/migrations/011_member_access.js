const sequelize = require('../config/database');

async function up() {
  const [[accessTypeCol]] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_members'
      AND COLUMN_NAME = 'access_type'
  `);
  if (!accessTypeCol) {
    await sequelize.query(`
      ALTER TABLE event_members
        ADD COLUMN access_type ENUM('full', 'partial') NOT NULL DEFAULT 'partial',
        ADD COLUMN face_scan_count INT NOT NULL DEFAULT 0;
    `);
    // Existing organizer rows get full access
    await sequelize.query(`
      UPDATE event_members SET access_type = 'full' WHERE role = 'organizer';
    `);
  }
  console.log('[Migration 011] event_members.access_type + face_scan_count ready');
}

module.exports = { up };
