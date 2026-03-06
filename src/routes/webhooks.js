const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { Subscription, User } = require('../models');
const { sendNotification } = require('../services/notificationService');

// POST /webhooks/razorpay
// Raw body needed for HMAC verification — must be registered before express.json() parses it
router.post('/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (secret && signature) {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(req.body)
      .digest('hex');
    if (expected !== signature) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const event = payload.event;

  try {
    if (event === 'payment.failed') {
      const orderId = payload.payload?.payment?.entity?.order_id;
      if (orderId) {
        const sub = await Subscription.findOne({ where: { razorpay_order_id: orderId } });
        if (sub) {
          const graceUntil = new Date();
          graceUntil.setDate(graceUntil.getDate() + 30);
          await sub.update({ status: 'grace_period', grace_until: graceUntil });

          setImmediate(() => {
            sendNotification({
              userId: sub.user_id,
              type: 'payment_failed',
              title: 'Payment Failed',
              body: 'Your subscription payment failed. You have a 30-day grace period to renew.',
              data: { screen: 'billing_status' },
            }).catch(() => {});
          });
        }
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }

  res.json({ status: 'ok' });
});

module.exports = router;
