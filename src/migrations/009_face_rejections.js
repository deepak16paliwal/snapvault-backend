const sequelize = require('../config/database');

async function up() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS face_rejections (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      photo_id INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_photo (user_id, photo_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  console.log('[Migration 008] face_rejections created');
}

module.exports = { up };
