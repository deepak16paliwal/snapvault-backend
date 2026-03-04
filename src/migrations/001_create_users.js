const sequelize = require('../config/database');

async function up() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      phone VARCHAR(20),
      role ENUM('end_user','organizer','admin') NOT NULL DEFAULT 'end_user',
      profile_photo_url VARCHAR(512),
      date_of_birth DATE,
      email_verified BOOLEAN DEFAULT FALSE,
      is_active BOOLEAN DEFAULT TRUE,
      subscription_plan ENUM('free','pro_monthly','pro_annual','enterprise_monthly','enterprise_annual') DEFAULT 'free',
      created_at DATETIME DEFAULT NOW(),
      updated_at DATETIME DEFAULT NOW() ON UPDATE NOW()
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log('✅ Migration 001: users table created');
}

async function down() {
  await sequelize.query(`DROP TABLE IF EXISTS users;`);
  console.log('🗑️  Migration 001: users table dropped');
}

module.exports = { up, down };
