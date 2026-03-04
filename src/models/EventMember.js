const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const EventMember = sequelize.define('EventMember', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  event_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  role: { type: DataTypes.ENUM('organizer', 'guest'), defaultValue: 'guest' },
  joined_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  tableName: 'event_members',
  underscored: true,
  timestamps: false,
});

module.exports = EventMember;
