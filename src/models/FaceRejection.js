const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const FaceRejection = sequelize.define('FaceRejection', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  photo_id: { type: DataTypes.INTEGER, allowNull: false },
}, {
  tableName: 'face_rejections',
  timestamps: false,
  underscored: true,
});

module.exports = FaceRejection;
