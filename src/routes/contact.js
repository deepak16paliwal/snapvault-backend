const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const ContactMessage = require('../models/ContactMessage');
const { sendContactAdminEmail, sendContactConfirmationEmail } = require('../services/emailService');

// POST /contact — public, no auth required
router.post('/', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('message').trim().notEmpty().withMessage('Message is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const { name, email, message } = req.body;

  try {
    await ContactMessage.create({ name, email, message });

    // Send both emails (non-blocking — don't fail request if email fails)
    sendContactAdminEmail(name, email, message).catch((err) =>
      console.error('[Contact] Admin email failed:', err.message)
    );
    sendContactConfirmationEmail(name, email, message).catch((err) =>
      console.error('[Contact] Confirmation email failed:', err.message)
    );

    res.json({ message: 'Message received. We will get back to you within 24–48 hours.' });
  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ error: 'Failed to submit message' });
  }
});

module.exports = router;
