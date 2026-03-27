const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const OrganizerPublicProfile = sequelize.define('OrganizerPublicProfile', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  organizer_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  slug: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  headline: { type: DataTypes.STRING(255), allowNull: true },
  bio: { type: DataTypes.TEXT, allowNull: true },
  template: {
    type: DataTypes.ENUM('minimal', 'gallery', 'video'),
    defaultValue: 'minimal',
  },
  social_instagram: { type: DataTypes.STRING(100), allowNull: true },
  social_website: { type: DataTypes.STRING(512), allowNull: true },
  is_published: { type: DataTypes.BOOLEAN, defaultValue: false },
}, {
  tableName: 'organizer_public_profiles',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = OrganizerPublicProfile;
