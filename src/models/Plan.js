const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Plan = sequelize.define('Plan', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  plan_key: { type: DataTypes.STRING(50), allowNull: false, unique: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  price_paise: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  max_photos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 20 },
  max_storage_mb: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 51 },
  max_videos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  bulk_download: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  analytics: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  toggle_downloads: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  gallery_themes: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  anonymous_viewing: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  max_face_scans_per_event: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  retention_days: { type: DataTypes.INTEGER, allowNull: true },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  tableName: 'plans',
  timestamps: false,
});

module.exports = Plan;
