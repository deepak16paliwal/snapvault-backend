require('dotenv').config();

const required = ['JWT_SECRET', 'MJ_APIKEY_PUBLIC', 'MJ_APIKEY_SECRET', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT) || 3306,
    name: process.env.DB_NAME || 'snapvault_dev',
    user: process.env.DB_USER || 'root',
    pass: process.env.DB_PASS || '',
  },

  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT) || 6379,
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: '30d',
  },

  email: {
    apiKey: process.env.MJ_APIKEY_PUBLIC,
    secretKey: process.env.MJ_APIKEY_SECRET,
    fromName: process.env.EMAIL_FROM_NAME || 'SnapLivo',
    fromAddress: process.env.EMAIL_FROM_ADDRESS || 'support@snaplivo.in',
  },

  aws: {
    region: process.env.AWS_REGION || 'ap-south-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },

  r2: {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET || 'snaplivo-photos',
  },
};
