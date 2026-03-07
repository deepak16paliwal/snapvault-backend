const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Event = sequelize.define('Event', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  organizer_id: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  event_date: { type: DataTypes.DATEONLY },
  location: { type: DataTypes.STRING(512) },
  cover_photo_url: { type: DataTypes.STRING(512) },
  invite_token: { type: DataTypes.STRING(64), unique: true, allowNull: false },
  expires_at: { type: DataTypes.DATE, allowNull: true },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
  soft_deleted_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'events',
  underscored: true,
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Event;
