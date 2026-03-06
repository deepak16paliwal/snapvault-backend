const sequelize = require('../config/database');

async function up() {
  // Add stored_size_bytes column to photos table (idempotent)
  const [cols] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'photos' AND COLUMN_NAME = 'stored_size_bytes'
  `);
  if (cols.length === 0) {
    await sequelize.query(`
      ALTER TABLE photos ADD COLUMN stored_size_bytes BIGINT DEFAULT NULL AFTER file_size
    `);
    console.log('[Migration 008] Added stored_size_bytes column to photos');
  }
}

module.exports = { up };
