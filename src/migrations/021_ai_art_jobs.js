const sequelize = require('../config/database');

async function up() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ai_art_jobs (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      user_id            INT NOT NULL,
      prompt             TEXT NOT NULL,
      negative_prompt    TEXT,
      model_name         VARCHAR(100) DEFAULT 'JuggernautXL_v9',
      width              INT DEFAULT 1024,
      height             INT DEFAULT 1024,
      steps              INT DEFAULT 20,
      cfg                FLOAT DEFAULT 7.0,
      input_storage_key  VARCHAR(512),
      comfyui_prompt_id  VARCHAR(255),
      status             ENUM('pending','processing','done','failed') DEFAULT 'pending',
      result_storage_key VARCHAR(512),
      error_message      TEXT,
      created_at         DATETIME DEFAULT NOW(),
      updated_at         DATETIME DEFAULT NOW() ON UPDATE NOW()
    )
  `);
  console.log('[Migration 021] ai_art_jobs ready');
}

module.exports = { up };
