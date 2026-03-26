const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: { isEmail: true },
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  role: {
    type: DataTypes.ENUM('end_user', 'organizer', 'admin'),
    allowNull: false,
    defaultValue: 'end_user',
  },
  profile_photo_url: {
    type: DataTypes.STRING(512),
    allowNull: true,
  },
  date_of_birth: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  email_verified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  subscription_plan: {
    type: DataTypes.ENUM('free', 'basic', 'standard', 'essential', 'premium'),
    defaultValue: 'free',
  },
  storage_consumed_bytes: { type: DataTypes.BIGINT, defaultValue: 0 },
}, {
  tableName: 'users',
});

module.exports = User;
