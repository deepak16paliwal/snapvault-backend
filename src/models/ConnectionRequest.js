const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ConnectionRequest = sequelize.define('ConnectionRequest', {
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  event_id:     { type: DataTypes.INTEGER, allowNull: false },
  requester_id: { type: DataTypes.INTEGER, allowNull: false },
  organizer_id: { type: DataTypes.INTEGER, allowNull: false },
  message:      { type: DataTypes.TEXT, allowNull: true },
  created_at:   { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  tableName: 'connection_requests',
  underscored: true,
  timestamps: false,
});

module.exports = ConnectionRequest;
