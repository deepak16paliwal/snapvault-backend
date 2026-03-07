const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const User = require('../models/User');
const { FaceRejection, EventMember } = require('../models');
const { storeOtp, verifyOtp } = require('../services/otpService');
const { sendOtpEmail } = require('../services/emailService');
const { signToken } = require('../services/jwtService');
const { authenticate } = require('../middleware/authMiddleware');
const { getUploadUrl, presignStoredUrl } = require('../services/s3Service');
const env = require('../config/env');

const presignProfilePhoto = presignStoredUrl;

// Helper: return first validation error
function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return false;
  }
  return true;
}

// POST /auth/register
// Creates user and sends OTP to email
router.post('/register', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('phone')
    .trim()
    .notEmpty().withMessage('Phone number is required')
    .matches(/^\+?[0-9\s\-().]{7,20}$/).withMessage('Enter a valid phone number'),
  body('role').isIn(['end_user', 'organizer']).withMessage('Role must be end_user or organizer'),
], async (req, res) => {
  if (!validate(req, res)) return;

  const { name, email, phone, role } = req.body;

  try {
    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const user = await User.create({ name, email, phone, role });

    let emailSent = true;
    try {
      const otp = await storeOtp(email);
      await sendOtpEmail(email, otp);
    } catch (emailErr) {
      emailSent = false;
      console.error('Email delivery failed:', emailErr.message);
    }

    res.status(201).json({
      message: emailSent
        ? 'Registered successfully. OTP sent to your email.'
        : 'Registered successfully. Email delivery failed — use /auth/send-otp to retry.',
      user_id: user.id,
      email_sent: emailSent,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /auth/send-otp
// Send/resend OTP for login or re-verification
router.post('/send-otp', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
], async (req, res) => {
  if (!validate(req, res)) return;

  const { email } = req.body;

  try {
    const user = await User.findOne({ where: { email, is_active: true } });
    if (!user) {
      return res.status(404).json({ error: 'No account found with this email' });
    }

    const otp = await storeOtp(email);
    await sendOtpEmail(email, otp);

    res.json({ message: 'OTP sent to your email' });
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// POST /auth/verify-otp
// Verify OTP and return JWT
router.post('/verify-otp', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('otp').trim().matches(/^\d{6}$/).withMessage('OTP must be exactly 6 digits'),
], async (req, res) => {
  if (!validate(req, res)) return;

  const { email, otp } = req.body;

  try {
    const result = await verifyOtp(email, otp);

    if (!result.success) {
      const messages = {
        otp_expired: 'OTP has expired. Please request a new one.',
        invalid_otp: 'Incorrect OTP. Please try again.',
        too_many_attempts: 'Too many failed attempts. Request a new OTP.',
      };
      const status = result.error === 'too_many_attempts' ? 429 : 400;
      return res.status(status).json({ error: messages[result.error] || 'OTP verification failed' });
    }

    const user = await User.findOne({ where: { email, is_active: true } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Mark email as verified
    if (!user.email_verified) {
      await user.update({ email_verified: true });
    }

    const token = signToken({ user_id: user.id, role: user.role, email: user.email });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        subscription_plan: user.subscription_plan,
      },
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'OTP verification failed' });
  }
});

// GET /auth/me
// Return current user profile
router.get('/me', authenticate, async (req, res) => {
  const user = req.user;
  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      profile_photo_url: await presignProfilePhoto(user.profile_photo_url),
      date_of_birth: user.date_of_birth,
      email_verified: user.email_verified,
      subscription_plan: user.subscription_plan,
      created_at: user.created_at,
    },
  });
});

// PATCH /auth/profile
// Update name, profile photo, date of birth
router.patch('/profile', authenticate, [
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('date_of_birth').optional().isDate().withMessage('Invalid date format (YYYY-MM-DD)'),
  body('profile_photo_url').optional().isURL().withMessage('Invalid URL'),
], async (req, res) => {
  if (!validate(req, res)) return;

  const { name, profile_photo_url, date_of_birth, phone } = req.body;

  try {
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (profile_photo_url !== undefined) updates.profile_photo_url = profile_photo_url;
    if (date_of_birth !== undefined) updates.date_of_birth = date_of_birth;
    if (phone !== undefined) updates.phone = phone;

    await req.user.update(updates);
    await req.user.reload();

    res.json({
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
        profile_photo_url: await presignProfilePhoto(req.user.profile_photo_url),
        date_of_birth: req.user.date_of_birth,
      },
    });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// POST /auth/profile/photo-url
// Generate a presigned S3 URL for uploading a profile photo
router.post('/profile/photo-url', authenticate, async (req, res) => {
  try {
    const { filename, mime_type } = req.body;
    const ext = (filename || 'photo').split('.').pop() || 'jpg';
    const key = `profiles/${req.user.id}/${Date.now()}.${ext}`;
    const uploadUrl = await getUploadUrl(key, mime_type || 'image/jpeg');
    const photoUrl = `https://${env.aws.s3Bucket}.s3.${env.aws.region}.amazonaws.com/${key}`;
    res.json({ upload_url: uploadUrl, photo_url: photoUrl });
  } catch (err) {
    console.error('Profile photo URL error:', err);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// DELETE /auth/face-data
// Clears stored face identity (matched_face_ids + FaceRejections).
// Does NOT reset face_scan_count or user_photo_matches (My Photos history is preserved).
router.delete('/face-data', authenticate, async (req, res) => {
  try {
    await Promise.all([
      FaceRejection.destroy({ where: { user_id: req.user.id } }),
      EventMember.update({ matched_face_ids: null }, { where: { user_id: req.user.id } }),
    ]);
    res.json({ message: 'Face data cleared successfully' });
  } catch (err) {
    console.error('Clear face data error:', err);
    res.status(500).json({ error: 'Failed to clear face data' });
  }
});

// DELETE /auth/account
// Deactivate user account (soft delete)
router.delete('/account', authenticate, async (req, res) => {
  try {
    await req.user.update({ is_active: false });
    res.json({ message: 'Account deactivated successfully' });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Failed to deactivate account' });
  }
});

module.exports = router;
