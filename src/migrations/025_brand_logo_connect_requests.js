const sequelize = require('../config/database');

async function up() {
  const q = sequelize.getQueryInterface();

  // Add brand_logo_url to events
  const eventsDesc = await q.describeTable('events').catch(() => null);
  if (eventsDesc && !eventsDesc.brand_logo_url) {
    await q.addColumn('events', 'brand_logo_url', {
      type: require('sequelize').DataTypes.STRING(512),
      allowNull: true,
      defaultValue: null,
    });
    console.log('[Migration 025] Added events.brand_logo_url');
  }

  // Create connection_requests table
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS connection_requests (
      id           INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
      event_id     INT          NOT NULL,
      requester_id INT          NOT NULL,
      organizer_id INT          NOT NULL,
      message      TEXT,
      created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_connect (event_id, requester_id, organizer_id),
      INDEX idx_organizer (organizer_id),
      INDEX idx_requester (requester_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  console.log('[Migration 025] connection_requests table ready');
}

module.exports = { up };
