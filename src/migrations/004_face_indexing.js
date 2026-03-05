const sequelize = require('../config/database');

async function up() {
  // Add face columns to photos (idempotent via IF NOT EXISTS workaround)
  const [[cols]] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'photos'
      AND COLUMN_NAME IN ('face_index_status', 'face_indexed_at')
  `);
  if (!cols) {
    await sequelize.query(`
      ALTER TABLE photos
        ADD COLUMN face_index_status ENUM('pending','indexed','no_faces','failed') NOT NULL DEFAULT 'pending',
        ADD COLUMN face_indexed_at DATETIME NULL;
    `);
  }

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS photo_faces (
      id INT PRIMARY KEY AUTO_INCREMENT,
      photo_id INT NOT NULL,
      rekognition_face_id VARCHAR(255) NOT NULL,
      confidence FLOAT NOT NULL,
      UNIQUE KEY uq_photo_face (photo_id, rekognition_face_id),
      FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  console.log('[Migration 004] face_index_status + photo_faces created');
}

module.exports = { up };
