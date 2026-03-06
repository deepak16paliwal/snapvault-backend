const sequelize = require('../config/database');

async function up() {
  // ── 1. Create plans table ──────────────────────────────────────────────────
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS plans (
      id                INT PRIMARY KEY AUTO_INCREMENT,
      plan_key          VARCHAR(50) NOT NULL UNIQUE,
      name              VARCHAR(100) NOT NULL,
      price_paise       INT NOT NULL DEFAULT 0,
      max_photos        INT NOT NULL DEFAULT 20,
      max_storage_mb    INT NOT NULL DEFAULT 51,
      max_videos        INT NOT NULL DEFAULT 0,
      bulk_download     TINYINT(1) NOT NULL DEFAULT 0,
      analytics         TINYINT(1) NOT NULL DEFAULT 0,
      toggle_downloads  TINYINT(1) NOT NULL DEFAULT 0,
      gallery_themes    TINYINT(1) NOT NULL DEFAULT 0,
      anonymous_viewing TINYINT(1) NOT NULL DEFAULT 0,
      retention_days    INT NULL,
      sort_order        INT NOT NULL DEFAULT 0,
      is_active         TINYINT(1) NOT NULL DEFAULT 1,
      created_at        DATETIME DEFAULT NOW(),
      updated_at        DATETIME ON UPDATE NOW()
    )
  `);

  // ── 2. Seed initial plans (INSERT IGNORE is idempotent) ──────────────────
  await sequelize.query(`
    INSERT IGNORE INTO plans
      (plan_key, name, price_paise, max_photos, max_storage_mb, max_videos,
       bulk_download, analytics, toggle_downloads, gallery_themes, anonymous_viewing,
       retention_days, sort_order)
    VALUES
      ('free',      'Free',      0,      20,    51,     0,  0, 0, 0, 0, 0, 30,   0),
      ('basic',     'Basic',     99900,  5000,  30720,  10, 0, 0, 0, 0, 0, NULL, 1),
      ('standard',  'Standard',  199900, 10000, 71680,  10, 1, 0, 0, 0, 0, NULL, 2),
      ('essential', 'Essential', 399900, 30000, 153600, 30, 1, 1, 0, 0, 0, NULL, 3),
      ('premium',   'Premium',   690000, 50000, 256000, 50, 1, 1, 1, 1, 1, NULL, 4)
  `);

  // ── 3. Update users.subscription_plan ENUM (idempotent) ──────────────────
  const [[cols]] = await sequelize.query(`
    SELECT COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'subscription_plan'
  `);
  if (cols && !cols.COLUMN_TYPE.includes("'basic'")) {
    await sequelize.query(`
      ALTER TABLE users
        MODIFY subscription_plan
          ENUM('free','basic','standard','essential','premium') DEFAULT 'free'
    `);
  }

  // ── 4. Create subscriptions table ─────────────────────────────────────────
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id                    INT PRIMARY KEY AUTO_INCREMENT,
      user_id               INT NOT NULL,
      plan_key              VARCHAR(50) NOT NULL,
      status                ENUM('active','expired','cancelled','grace_period') NOT NULL DEFAULT 'active',
      razorpay_payment_id   VARCHAR(255),
      razorpay_order_id     VARCHAR(255),
      amount_paise          INT,
      start_date            DATETIME NOT NULL,
      end_date              DATETIME,
      grace_until           DATETIME,
      created_at            DATETIME DEFAULT NOW(),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (plan_key) REFERENCES plans(plan_key),
      INDEX idx_sub_user_id (user_id)
    )
  `);

  console.log('Migration 007: subscriptions done');
}

module.exports = { up };
