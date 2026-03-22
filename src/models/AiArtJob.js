const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AiArtJob = sequelize.define('AiArtJob', {
  id:                 { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id:            { type: DataTypes.INTEGER, allowNull: false },
  prompt:             { type: DataTypes.TEXT, allowNull: false },
  negative_prompt:    { type: DataTypes.TEXT },
  model_name:         { type: DataTypes.STRING(100), defaultValue: 'JuggernautXL_v9' },
  width:              { type: DataTypes.INTEGER, defaultValue: 1024 },
  height:             { type: DataTypes.INTEGER, defaultValue: 1024 },
  steps:              { type: DataTypes.INTEGER, defaultValue: 20 },
  cfg:                { type: DataTypes.FLOAT, defaultValue: 7.0 },
  input_storage_key:  { type: DataTypes.STRING(512) },
  comfyui_prompt_id:  { type: DataTypes.STRING(255) },
  status:             { type: DataTypes.ENUM('pending','processing','done','failed'), defaultValue: 'pending' },
  result_storage_key: { type: DataTypes.STRING(512) },
  error_message:      { type: DataTypes.TEXT },
}, {
  tableName: 'ai_art_jobs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = AiArtJob;
