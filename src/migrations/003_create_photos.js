const sequelize = require('../config/database');

async function up() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS photos (
      id INT PRIMARY KEY AUTO_INCREMENT,
      event_id INT NOT NULL,
      uploader_id INT NOT NULL,
      original_filename VARCHAR(255),
      s3_key VARCHAR(512) NOT NULL,
      thumbnail_key VARCHAR(512),
      file_size INT,
      mime_type VARCHAR(100),
      status ENUM('pending', 'uploaded', 'failed') DEFAULT 'pending',
      created_at DATETIME DEFAULT NOW(),
      FOREIGN KEY (event_id) REFERENCES events(id),
      FOREIGN KEY (uploader_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('Migration 003: photos table ready');
}

module.exports = { up };
