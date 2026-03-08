const { Sequelize } = require('sequelize');
const env = require('./env');

const socketPath = process.env.DB_SOCKET_PATH;

const sequelize = new Sequelize(env.db.name, env.db.user, env.db.pass, {
  dialect: 'mysql',
  logging: env.nodeEnv === 'development' ? console.log : false,
  ...(socketPath
    ? { dialectOptions: { socketPath } }
    : { host: env.db.host, port: env.db.port }),
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  define: {
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
});

module.exports = sequelize;
