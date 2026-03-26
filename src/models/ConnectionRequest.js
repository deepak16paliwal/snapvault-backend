const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ConnectionRequest = sequelize.define('ConnectionRequest', {
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  event_id:     { type: DataTypes.INTEGER, allowNull: false },
  requester_id: { type: DataTypes.INTEGER, allowNull: false },
  organizer_id: { type: DataTypes.INTEGER, allowNull: false },
  message:      { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'connection_requests',
  underscored: true,
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
});

module.exports = ConnectionRequest;
