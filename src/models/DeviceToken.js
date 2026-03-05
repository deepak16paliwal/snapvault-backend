const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DeviceToken = sequelize.define('DeviceToken', {
  user_id:   { type: DataTypes.INTEGER, allowNull: false },
  fcm_token: { type: DataTypes.STRING(512), allowNull: false },
  platform:  { type: DataTypes.ENUM('ios', 'android'), allowNull: false },
}, {
  tableName: 'device_tokens',
  timestamps: false,
  updatedAt: 'updated_at',
});

module.exports = DeviceToken;
