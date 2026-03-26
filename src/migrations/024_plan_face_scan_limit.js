const sequelize = require('../config/database');

async function up() {
  const [[col]] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
      AND COLUMN_NAME = 'max_face_scans_per_event'
  `);

  if (!col) {
    await sequelize.query(`
      ALTER TABLE plans ADD COLUMN max_face_scans_per_event INT NOT NULL DEFAULT 1
    `);
    // Set per-plan values — adjustable later via PATCH /billing/admin/plans/:plan_key
    await sequelize.query(`UPDATE plans SET max_face_scans_per_event = 1 WHERE plan_key IN ('free', 'starter')`);
    await sequelize.query(`UPDATE plans SET max_face_scans_per_event = 2 WHERE plan_key = 'basic'`);
    await sequelize.query(`UPDATE plans SET max_face_scans_per_event = 3 WHERE plan_key = 'standard'`);
    await sequelize.query(`UPDATE plans SET max_face_scans_per_event = 5 WHERE plan_key IN ('essential', 'premium')`);
    console.log('[Migration 024] plans.max_face_scans_per_event added + seeded');
  } else {
    console.log('[Migration 024] plans.max_face_scans_per_event already exists');
  }
}

module.exports = { up };
