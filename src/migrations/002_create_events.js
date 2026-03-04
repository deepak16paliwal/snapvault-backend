const sequelize = require('../config/database');

async function up() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS events (
      id INT PRIMARY KEY AUTO_INCREMENT,
      organizer_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      event_date DATE,
      location VARCHAR(512),
      cover_photo_url VARCHAR(512),
      invite_token VARCHAR(64) UNIQUE NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at DATETIME DEFAULT NOW(),
      updated_at DATETIME ON UPDATE NOW(),
      FOREIGN KEY (organizer_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS event_members (
      id INT PRIMARY KEY AUTO_INCREMENT,
      event_id INT NOT NULL,
      user_id INT NOT NULL,
      role ENUM('organizer', 'guest') DEFAULT 'guest',
      joined_at DATETIME DEFAULT NOW(),
      UNIQUE KEY unique_member (event_id, user_id),
      FOREIGN KEY (event_id) REFERENCES events(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('Migration 002: events + event_members tables ready');
}

module.exports = { up };
