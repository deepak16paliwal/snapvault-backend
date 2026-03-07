const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { authenticate } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/authMiddleware');
const razorpay = require('../config/razorpay');
const { Plan, Subscription, User } = require('../models');
const { sendNotification } = require('../services/notificationService');
const { getStorageUsed } = require('../services/quotaService');
const { sendPaymentFailedEmail } = require('../services/emailService');

// Only organizers pay for storage
function requireOrganizer(req, res, next) {
  if (req.user.role !== 'organizer') {
    return res.status(403).json({ error: 'Subscriptions are only available for event organizers' });
  }
  next();
}

// ── GET /billing/plans ─────────────────────────────────────────────────────
// Public: returns all active plans sorted by sort_order
router.get('/plans', async (req, res) => {
  try {
    const plans = await Plan.findAll({
      where: { is_active: true },
      order: [['sort_order', 'ASC']],
    });
    res.json({ plans });
  } catch (err) {
    console.error('GET /billing/plans:', err);
    res.status(500).json({ error: 'Failed to load plans' });
  }
});

// ── GET /billing/my-plan ───────────────────────────────────────────────────
router.get('/my-plan', authenticate, requireOrganizer, async (req, res) => {
  try {
    const plan = await Plan.findOne({ where: { plan_key: req.user.subscription_plan || 'free' } });
    const subscription = await Subscription.findOne({
      where: { user_id: req.user.id, status: 'active' },
      order: [['id', 'DESC']],
    });
    const storage_used_bytes = await getStorageUsed(req.user.id);
    res.json({ plan, subscription, storage_used_bytes });
  } catch (err) {
    console.error('GET /billing/my-plan:', err);
    res.status(500).json({ error: 'Failed to load plan' });
  }
});

// ── POST /billing/create-order ─────────────────────────────────────────────
router.post('/create-order', authenticate, requireOrganizer, async (req, res) => {
  const { plan_key } = req.body;
  if (!plan_key) return res.status(400).json({ error: 'plan_key required' });

  try {
    const plan = await Plan.findOne({ where: { plan_key, is_active: true } });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.price_paise === 0) return res.status(400).json({ error: 'Free plan does not require payment' });

    const order = await razorpay.orders.create({
      amount: plan.price_paise,
      currency: 'INR',
      receipt: `sub_${req.user.id}_${Date.now()}`,
      notes: { user_id: String(req.user.id), plan_key },
    });

    res.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key: process.env.RAZORPAY_KEY_ID,
      plan_name: plan.name,
    });
  } catch (err) {
    console.error('POST /billing/create-order:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// ── POST /billing/verify-payment ──────────────────────────────────────────
router.post('/verify-payment', authenticate, requireOrganizer, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan_key } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !plan_key) {
    return res.status(400).json({ error: 'Missing payment fields' });
  }

  // Verify HMAC-SHA256 signature
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expected !== razorpay_signature) {
    return res.status(400).json({ error: 'Payment signature verification failed' });
  }

  try {
    const plan = await Plan.findOne({ where: { plan_key, is_active: true } });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 1); // annual plan

    await Subscription.create({
      user_id: req.user.id,
      plan_key,
      status: 'active',
      razorpay_payment_id,
      razorpay_order_id,
      amount_paise: plan.price_paise,
      start_date: startDate,
      end_date: endDate,
    });

    await User.update({ subscription_plan: plan_key }, { where: { id: req.user.id } });

    // Fire-and-forget notification
    setImmediate(() => {
      sendNotification({
        userId: req.user.id,
        type: 'subscription_confirmed',
        title: 'Subscription Activated',
        body: `Your ${plan.name} plan is now active. Enjoy your upgraded features!`,
        data: { screen: 'billing_status' },
      }).catch(() => {});
    });

    res.json({ success: true, plan_key, plan_name: plan.name });
  } catch (err) {
    console.error('POST /billing/verify-payment:', err);
    res.status(500).json({ error: 'Failed to activate subscription' });
  }
});

// ── GET /billing/history ───────────────────────────────────────────────────
router.get('/history', authenticate, requireOrganizer, async (req, res) => {
  try {
    const subscriptions = await Subscription.findAll({
      where: { user_id: req.user.id },
      include: [{ model: Plan, foreignKey: 'plan_key', as: 'Plan' }],
      order: [['id', 'DESC']],
    });
    res.json({ subscriptions });
  } catch (err) {
    console.error('GET /billing/history:', err);
    res.status(500).json({ error: 'Failed to load billing history' });
  }
});

// ── POST /billing/webhook ──────────────────────────────────────────────────
// Razorpay webhook — handles payment.failed → starts grace period
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return res.status(400).json({ error: 'Missing signature' });

  const expected = crypto
    .createHmac('sha256', secret)
    .update(req.body)
    .digest('hex');
  if (expected !== signature) return res.status(400).json({ error: 'Invalid signature' });

  let event;
  try {
    event = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (event.event === 'payment.failed') {
    const orderId = event.payload?.payment?.entity?.order_id;
    if (orderId) {
      try {
        const sub = await Subscription.findOne({
          where: { razorpay_order_id: orderId, status: 'active' },
          include: [
            { model: User, attributes: ['id', 'email'] },
            { model: Plan, foreignKey: 'plan_key', as: 'Plan', attributes: ['name'] },
          ],
        });
        if (sub) {
          const graceUntil = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
          await sub.update({ status: 'grace_period', grace_until: graceUntil });
          const planName = sub.Plan?.name || sub.plan_key;
          await sendNotification({
            userId: sub.user_id,
            type: 'payment_failed',
            title: 'Payment Failed',
            body: `Your payment for the ${planName} plan failed. You have 15 days to retry before downgrade.`,
            data: { screen: 'billing_status' },
          }).catch(() => {});
          if (sub.User?.email) {
            await sendPaymentFailedEmail(sub.User.email, planName).catch(() => {});
          }
          console.log(`[Webhook] payment.failed — user ${sub.user_id} moved to grace_period`);
        }
      } catch (err) {
        console.error('[Webhook] payment.failed handling error:', err.message);
      }
    }
  }

  res.json({ received: true });
});

// ── ADMIN: GET /billing/admin/plans ───────────────────────────────────────
router.get('/admin/plans', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const plans = await Plan.findAll({ order: [['sort_order', 'ASC']] });
    res.json({ plans });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load plans' });
  }
});

// ── ADMIN: PATCH /billing/admin/plans/:plan_key ───────────────────────────
router.patch('/admin/plans/:plan_key', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const plan = await Plan.findOne({ where: { plan_key: req.params.plan_key } });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const allowed = [
      'name', 'price_paise', 'max_photos', 'max_storage_mb', 'max_videos',
      'bulk_download', 'analytics', 'toggle_downloads', 'gallery_themes',
      'anonymous_viewing', 'retention_days', 'sort_order', 'is_active',
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    await plan.update(updates);
    res.json({ success: true, plan });
  } catch (err) {
    console.error('PATCH /billing/admin/plans:', err);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// ── ADMIN: POST /billing/admin/plans ─────────────────────────────────────
router.post('/admin/plans', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const plan = await Plan.create(req.body);
    res.status(201).json({ success: true, plan });
  } catch (err) {
    console.error('POST /billing/admin/plans:', err);
    res.status(500).json({ error: 'Failed to create plan' });
  }
});

// ── ADMIN: PATCH /billing/admin/plans/:plan_key/deactivate ───────────────
router.patch('/admin/plans/:plan_key/deactivate', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await Plan.update({ is_active: false }, { where: { plan_key: req.params.plan_key } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deactivate plan' });
  }
});

module.exports = router;
