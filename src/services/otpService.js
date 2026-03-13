const crypto = require('crypto');
const redis = require('../config/redis');

const OTP_TTL_SECONDS = 10 * 60;       // 10 minutes
const MAX_ATTEMPTS = 5;
const LOCKOUT_TTL_SECONDS = 15 * 60;   // 15 minutes

function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

function hashOtp(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

async function storeOtp(email) {
  // Demo account bypass — no Redis, no random OTP
  if (process.env.DEMO_EMAIL && email === process.env.DEMO_EMAIL) {
    return process.env.DEMO_OTP || '123456';
  }

  const otp = generateOtp();
  const hashed = hashOtp(otp);
  const key = `otp:${email}`;
  const attemptsKey = `otp_attempts:${email}`;

  await redis.set(key, hashed, 'EX', OTP_TTL_SECONDS);
  await redis.del(attemptsKey); // reset attempts on new OTP

  return otp; // raw OTP to send via email
}

async function verifyOtp(email, inputOtp) {
  // Demo account bypass — always accept the static OTP, no Redis needed
  if (process.env.DEMO_EMAIL && email === process.env.DEMO_EMAIL) {
    const demoOtp = process.env.DEMO_OTP || '123456';
    return inputOtp === demoOtp
      ? { success: true }
      : { success: false, error: 'invalid_otp' };
  }

  const key = `otp:${email}`;
  const attemptsKey = `otp_attempts:${email}`;

  // Check lockout
  const attempts = parseInt(await redis.get(attemptsKey)) || 0;
  if (attempts >= MAX_ATTEMPTS) {
    return { success: false, error: 'too_many_attempts' };
  }

  const storedHash = await redis.get(key);
  if (!storedHash) {
    return { success: false, error: 'otp_expired' };
  }

  const inputHash = hashOtp(inputOtp);
  if (inputHash !== storedHash) {
    // Increment attempts
    await redis.set(attemptsKey, attempts + 1, 'EX', LOCKOUT_TTL_SECONDS);
    return { success: false, error: 'invalid_otp' };
  }

  // Valid — clean up
  await redis.del(key);
  await redis.del(attemptsKey);
  return { success: true };
}

module.exports = { storeOtp, verifyOtp };
