const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PhotoFace = sequelize.define(
  'PhotoFace',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    photo_id: { type: DataTypes.INTEGER, allowNull: false },
    event_id: { type: DataTypes.INTEGER, allowNull: true },
    rekognition_face_id: { type: DataTypes.STRING(255), allowNull: false },
    bounding_box: { type: DataTypes.JSON, allowNull: true },
    confidence: { type: DataTypes.FLOAT, allowNull: false },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: 'photo_faces',
    timestamps: false,
    underscored: true,
  }
);

module.exports = PhotoFace;
