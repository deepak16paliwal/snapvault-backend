const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ContactMessage = sequelize.define('ContactMessage', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  email: { type: DataTypes.STRING(255), allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  tableName: 'contact_messages',
  timestamps: false,
});

module.exports = ContactMessage;
