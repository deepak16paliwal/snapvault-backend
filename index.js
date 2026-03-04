const env = require('./src/config/env');
const app = require('./src/app');
const sequelize = require('./src/config/database');
const redis = require('./src/config/redis');
const { up: runMigration } = require('./src/migrations/001_create_users');

async function start() {
  try {
    // Connect Redis
    await redis.connect();

    // Connect MySQL
    await sequelize.authenticate();
    console.log('MySQL connected');

    // Run migration (creates tables if not exist)
    await runMigration();

    // Start server
    app.listen(env.port, () => {
      console.log(`SnapVault backend running on port ${env.port}`);
    });
  } catch (err) {
    console.error('Startup failed:', err);
    process.exit(1);
  }
}

start();
