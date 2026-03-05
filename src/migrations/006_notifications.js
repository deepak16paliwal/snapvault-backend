const sequelize = require('../config/database');

async function up() {
  const q = sequelize.getQueryInterface();

  // notifications table
  await q.sequelize.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         INT PRIMARY KEY AUTO_INCREMENT,
      user_id    INT NOT NULL,
      type       VARCHAR(64) NOT NULL,
      title      VARCHAR(255) NOT NULL,
      body       TEXT NOT NULL,
      data_json  JSON,
      is_read    TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT NOW(),
      INDEX idx_notif_user (user_id),
      INDEX idx_notif_read (is_read),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // device_tokens table
  await q.sequelize.query(`
    CREATE TABLE IF NOT EXISTS device_tokens (
      id         INT PRIMARY KEY AUTO_INCREMENT,
      user_id    INT NOT NULL,
      fcm_token  VARCHAR(512) NOT NULL,
      platform   ENUM('ios','android') NOT NULL,
      updated_at DATETIME DEFAULT NOW() ON UPDATE NOW(),
      UNIQUE KEY uq_user_token (user_id, fcm_token),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  console.log('Migration 006_notifications done');
}

module.exports = { up };
