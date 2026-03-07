const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UserPhotoMatch = sequelize.define('UserPhotoMatch', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  event_id: { type: DataTypes.INTEGER, allowNull: false },
  photo_id: { type: DataTypes.INTEGER, allowNull: false },
}, {
  tableName: 'user_photo_matches',
  underscored: true,
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
});

module.exports = UserPhotoMatch;
