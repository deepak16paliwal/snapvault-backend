const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Notification = sequelize.define('Notification', {
  user_id:    { type: DataTypes.INTEGER, allowNull: false },
  type:       { type: DataTypes.STRING(64), allowNull: false },
  title:      { type: DataTypes.STRING(255), allowNull: false },
  body:       { type: DataTypes.TEXT, allowNull: false },
  data_json:  { type: DataTypes.JSON },
  is_read:    { type: DataTypes.BOOLEAN, defaultValue: false },
}, {
  tableName: 'notifications',
  timestamps: false,
  createdAt: 'created_at',
});

module.exports = Notification;
