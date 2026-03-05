const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PhotoFace = sequelize.define(
  'PhotoFace',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    photo_id: { type: DataTypes.INTEGER, allowNull: false },
    rekognition_face_id: { type: DataTypes.STRING(255), allowNull: false },
    confidence: { type: DataTypes.FLOAT, allowNull: false },
  },
  {
    tableName: 'photo_faces',
    timestamps: false,
    underscored: true,
  }
);

module.exports = PhotoFace;
