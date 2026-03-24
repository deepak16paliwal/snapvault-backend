const express = require('express');
const router = express.Router();
const ContactMessage = require('../models/ContactMessage');
const { sendContactAdminEmail, sendContactConfirmationEmail } = require('../services/emailService');

// POST /contact — public, no auth required
router.post('/', async (req, res) => {
  const { name, email, message } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!email?.trim()) return res.status(400).json({ error: 'Email is required' });
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email address' });

  try {
    await ContactMessage.create({ name: name.trim(), email: email.trim().toLowerCase(), message: message.trim() });

    // Send both emails without blocking the response
    Promise.all([
      sendContactAdminEmail(name.trim(), email.trim(), message.trim()),
      sendContactConfirmationEmail(name.trim(), email.trim(), message.trim()),
    ]).catch(err => console.error('[contact] email error:', err.message));

    res.json({ message: 'Message received. We will get back to you soon.' });
  } catch (err) {
    console.error('[contact] error:', err.message);
    res.status(500).json({ error: 'Failed to save message. Please try again.' });
  }
});

module.exports = router;
