const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Photo = sequelize.define('Photo', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  event_id: { type: DataTypes.INTEGER, allowNull: false },
  uploader_id: { type: DataTypes.INTEGER, allowNull: false },
  original_filename: { type: DataTypes.STRING(255) },
  s3_key: { type: DataTypes.STRING(512), allowNull: false },
  thumbnail_key: { type: DataTypes.STRING(512) },
  file_size: { type: DataTypes.INTEGER },
  mime_type: { type: DataTypes.STRING(100) },
  status: {
    type: DataTypes.ENUM('pending', 'uploaded', 'failed'),
    defaultValue: 'pending',
  },
}, {
  tableName: 'photos',
  underscored: true,
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
});

module.exports = Photo;
