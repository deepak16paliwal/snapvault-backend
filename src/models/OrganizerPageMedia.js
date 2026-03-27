const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const OrganizerPageMedia = sequelize.define('OrganizerPageMedia', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  profile_id: { type: DataTypes.INTEGER, allowNull: false },
  organizer_id: { type: DataTypes.INTEGER, allowNull: false },
  media_type: { type: DataTypes.ENUM('image', 'video'), allowNull: false },
  storage_key: { type: DataTypes.STRING(512), allowNull: false },
  file_size_bytes: { type: DataTypes.BIGINT, defaultValue: 0 },
  order_index: { type: DataTypes.INTEGER, defaultValue: 0 },
}, {
  tableName: 'organizer_page_media',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
});

module.exports = OrganizerPageMedia;
