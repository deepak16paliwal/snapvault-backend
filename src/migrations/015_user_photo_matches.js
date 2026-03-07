const sequelize = require('../config/database');

async function up() {
  // Add matched_face_ids to event_members if not exists
  const [[col]] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_members'
      AND COLUMN_NAME = 'matched_face_ids'
  `);
  if (!col) {
    await sequelize.query(`ALTER TABLE event_members ADD COLUMN matched_face_ids JSON NULL`);
  }

  // Create user_photo_matches table
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS user_photo_matches (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      event_id INT NOT NULL,
      photo_id INT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_event_photo (user_id, event_id, photo_id),
      KEY idx_user_event (user_id, event_id)
    )
  `);

  console.log('[Migration 015] user_photo_matches + event_members.matched_face_ids ready');
}

module.exports = { up };
