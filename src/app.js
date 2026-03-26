const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Well-known files for Universal Links (iOS) and App Links (Android)
// Must be BEFORE helmet/rate-limit so Apple/Google can verify unauthenticated
app.get('/.well-known/apple-app-site-association', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json({
    applinks: {
      details: [{
        appIDs: ['ZA2JH67T7M.com.snaplivo.snaplivo'],
        components: [{ '/': '/events/join/*' }],
      }],
    },
  });
});

app.get('/.well-known/assetlinks.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.snaplivo.snaplivo',
      sha256_cert_fingerprints: ['B4:65:F9:7D:2E:0D:28:FE:67:9F:C7:6F:6A:DF:83:38:CA:C6:A5:60:D2:03:BE:FF:7A:E9:C1:29:88:42:D2:CE'],
    },
  }]);
});

// CORS — allow web dashboard and mobile apps
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin) return callback(null, true);
    const allowed =
      ALLOWED_ORIGINS.some(o => origin.startsWith(o)) ||
      origin.endsWith('.vercel.app');
    callback(allowed ? null : new Error('CORS not allowed'), allowed);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Security middleware
app.use(helmet());
app.use(express.json());

// Global rate limit: 100 requests per 15 min per IP
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
}));

// Auth-specific rate limit: 10 OTP requests per 15 min per IP
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many OTP requests, please try again later.' },
});
app.use('/auth/send-otp', otpLimiter);
app.use('/auth/verify-otp', otpLimiter);

// Face-search rate limit: max 5 scans per minute per IP (Rekognition costs money + abuse prevention)
// Per-user DB limit (2 scans/event) is the real gate; this prevents rapid-fire abuse
const faceScanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many face scan requests. Please wait a minute before trying again.' },
});
app.use('/photos/face-search', faceScanLimiter);

// Set up model associations (must be before routes)
require('./models');

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/events', require('./routes/events'));
app.use('/photos', require('./routes/photos'));
app.use('/notifications', require('./routes/notifications'));
app.use('/billing', require('./routes/billing'));
app.use('/webhooks', require('./routes/webhooks'));
app.use('/users', require('./routes/users'));
app.use('/contact', require('./routes/contact'));
app.use('/connect', require('./routes/connect'));

// Health check
app.get('/health', (req, res) => res.json({ status: 'Health ok' }));

// 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
