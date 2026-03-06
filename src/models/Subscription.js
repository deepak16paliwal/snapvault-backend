const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Subscription = sequelize.define('Subscription', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  plan_key: { type: DataTypes.STRING(50), allowNull: false },
  status: {
    type: DataTypes.ENUM('active', 'expired', 'cancelled', 'grace_period'),
    allowNull: false,
    defaultValue: 'active',
  },
  razorpay_payment_id: { type: DataTypes.STRING(255), allowNull: true },
  razorpay_order_id: { type: DataTypes.STRING(255), allowNull: true },
  amount_paise: { type: DataTypes.INTEGER, allowNull: true },
  start_date: { type: DataTypes.DATE, allowNull: false },
  end_date: { type: DataTypes.DATE, allowNull: true },
  grace_until: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'subscriptions',
  timestamps: false,
  createdAt: 'created_at',
});

module.exports = Subscription;
