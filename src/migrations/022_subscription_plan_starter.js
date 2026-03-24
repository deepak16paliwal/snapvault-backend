const sequelize = require('../config/database');

async function up() {
  // Add 'starter' to users.subscription_plan ENUM (idempotent)
  const [[col]] = await sequelize.query(`
    SELECT COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'subscription_plan'
  `);

  if (col && !col.COLUMN_TYPE.includes("'starter'")) {
    await sequelize.query(`
      ALTER TABLE users
        MODIFY subscription_plan
          ENUM('free','starter','basic','standard','essential','premium') DEFAULT 'free'
    `);
    console.log('[Migration 022] Added starter to subscription_plan ENUM');
  } else {
    console.log('[Migration 022] subscription_plan ENUM already up to date');
  }
}

module.exports = { up };
