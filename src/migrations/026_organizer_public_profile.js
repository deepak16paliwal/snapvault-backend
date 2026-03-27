const { sequelize } = require('../models');

async function up() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS organizer_public_profiles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      organizer_id INT NOT NULL UNIQUE,
      slug VARCHAR(100) NOT NULL UNIQUE,
      headline VARCHAR(255),
      bio TEXT,
      template ENUM('minimal','gallery','video') DEFAULT 'minimal',
      social_instagram VARCHAR(100),
      social_website VARCHAR(512),
      is_published BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT NOW(),
      updated_at DATETIME DEFAULT NOW() ON UPDATE NOW(),
      FOREIGN KEY (organizer_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_opp_slug (slug),
      INDEX idx_opp_organizer_id (organizer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS organizer_page_media (
      id INT AUTO_INCREMENT PRIMARY KEY,
      profile_id INT NOT NULL,
      organizer_id INT NOT NULL,
      media_type ENUM('image','video') NOT NULL,
      storage_key VARCHAR(512) NOT NULL,
      file_size_bytes BIGINT DEFAULT 0,
      order_index INT DEFAULT 0,
      created_at DATETIME DEFAULT NOW(),
      FOREIGN KEY (profile_id) REFERENCES organizer_public_profiles(id) ON DELETE CASCADE,
      INDEX idx_opm_profile_id (profile_id),
      INDEX idx_opm_organizer_id (organizer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  console.log('Migration 026: organizer_public_profiles + organizer_page_media created');
}

async function down() {
  await sequelize.query('DROP TABLE IF EXISTS organizer_page_media');
  await sequelize.query('DROP TABLE IF EXISTS organizer_public_profiles');
}

module.exports = { up, down };
