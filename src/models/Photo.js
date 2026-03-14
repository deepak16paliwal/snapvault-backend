const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Photo = sequelize.define('Photo', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  event_id: { type: DataTypes.INTEGER, allowNull: false },
  uploader_id: { type: DataTypes.INTEGER, allowNull: false },
  original_filename: { type: DataTypes.STRING(255) },
  s3_key: { type: DataTypes.STRING(512), allowNull: false },
  thumbnail_key: { type: DataTypes.STRING(512) },
  file_size: { type: DataTypes.BIGINT },         // original file size (shown to user)
  stored_size_bytes: { type: DataTypes.BIGINT },  // compressed size actually on S3
  mime_type: { type: DataTypes.STRING(100) },
  status: {
    type: DataTypes.ENUM('pending', 'uploaded', 'failed'),
    defaultValue: 'pending',
  },
  face_index_status: {
    type: DataTypes.ENUM('pending', 'indexed', 'no_faces', 'failed'),
    defaultValue: 'pending',
  },
  face_indexed_at: { type: DataTypes.DATE },
  image_hash: { type: DataTypes.STRING(64), allowNull: true },
  is_hidden: { type: DataTypes.BOOLEAN, defaultValue: false },
  is_pinned: { type: DataTypes.BOOLEAN, defaultValue: false },
  is_highlighted: { type: DataTypes.BOOLEAN, defaultValue: false },
}, {
  tableName: 'photos',
  underscored: true,
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
});

module.exports = Photo;
