const sequelize = require('../config/database');

async function up() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT NOW()
    )
  `);
  console.log('[Migration 020] contact_messages table ready');
}

module.exports = { up };
