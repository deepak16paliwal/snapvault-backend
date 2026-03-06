const express = require('express');
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
        appIDs: ['ZA2JH67T7M.com.snapvault.snapvault'],
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
      package_name: 'com.snapvault.snapvault',
      sha256_cert_fingerprints: ['B4:65:F9:7D:2E:0D:28:FE:67:9F:C7:6F:6A:DF:83:38:CA:C6:A5:60:D2:03:BE:FF:7A:E9:C1:29:88:42:D2:CE'],
    },
  }]);
});

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

// Set up model associations (must be before routes)
require('./models');

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/events', require('./routes/events'));
app.use('/photos', require('./routes/photos'));
app.use('/notifications', require('./routes/notifications'));
app.use('/billing', require('./routes/billing'));
app.use('/webhooks', require('./routes/webhooks'));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
