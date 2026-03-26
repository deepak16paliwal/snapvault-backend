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

// ── GET /billing/receipt/:id ───────────────────────────────────────────────
router.get('/receipt/:id', authenticate, requireOrganizer, async (req, res) => {
  try {
    const sub = await Subscription.findOne({
      where: { id: req.params.id, user_id: req.user.id },
      include: [{ model: Plan, foreignKey: 'plan_key', as: 'Plan' }],
    });
    if (!sub) return res.status(404).json({ error: 'Receipt not found' });

    const amountINR = ((sub.amount_paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
    const purchaseDate = new Date(sub.start_date || sub.created_at).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    const validUntil = sub.end_date
      ? new Date(sub.end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
      : '—';
    const planName = sub.Plan?.name || sub.plan_key;
    const receiptNo = `SLRCP-${sub.id.toString().padStart(6, '0')}`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Receipt ${receiptNo} — SnapLivo</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; background: #f4f5f7; display: flex; justify-content: center; padding: 40px 16px; }
    .card { background: #fff; max-width: 560px; width: 100%; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 32px rgba(0,0,0,0.10); }
    .header { background: linear-gradient(135deg, #0A0F1E 0%, #1a1040 100%); padding: 32px 36px; }
    .brand { font-size: 26px; font-weight: 800; color: #62D0F5; letter-spacing: -0.5px; }
    .badge { display: inline-block; background: #22c55e; color: #fff; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; padding: 3px 10px; border-radius: 20px; margin-top: 10px; }
    .body { padding: 32px 36px; }
    .receipt-no { font-size: 13px; color: #9ca3af; margin-bottom: 24px; }
    .receipt-no span { color: #374151; font-weight: 600; }
    .amount-row { display: flex; justify-content: space-between; align-items: center; padding: 18px 0; border-bottom: 1px solid #e5e7eb; margin-bottom: 24px; }
    .amount-label { font-size: 14px; color: #6b7280; }
    .amount-value { font-size: 30px; font-weight: 800; color: #111827; }
    .rows { display: flex; flex-direction: column; gap: 12px; margin-bottom: 28px; }
    .row { display: flex; justify-content: space-between; align-items: center; }
    .row-label { font-size: 13px; color: #9ca3af; }
    .row-value { font-size: 14px; color: #111827; font-weight: 500; text-align: right; max-width: 65%; word-break: break-all; }
    .divider { border: none; border-top: 1px dashed #e5e7eb; margin: 4px 0; }
    .footer { padding: 20px 36px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center; }
    .footer p { font-size: 12px; color: #9ca3af; line-height: 1.6; }
    .footer a { color: #0369a1; text-decoration: none; }
    .print-btn { display: block; width: 100%; margin-top: 28px; padding: 13px; background: #7b4dff; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 700; cursor: pointer; font-family: inherit; }
    @media print {
      body { background: #fff; padding: 0; }
      .card { box-shadow: none; border-radius: 0; }
      .print-btn { display: none; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="brand">SnapLivo</div>
      <div class="badge">✓ Payment Confirmed</div>
    </div>
    <div class="body">
      <div class="receipt-no">Receipt No: <span>${receiptNo}</span></div>
      <div class="amount-row">
        <div>
          <div class="amount-label">Amount Paid</div>
        </div>
        <div class="amount-value">₹${amountINR}</div>
      </div>
      <div class="rows">
        <div class="row">
          <span class="row-label">Plan</span>
          <span class="row-value">${planName} — Annual</span>
        </div>
        <hr class="divider"/>
        <div class="row">
          <span class="row-label">Purchase Date</span>
          <span class="row-value">${purchaseDate}</span>
        </div>
        <div class="row">
          <span class="row-label">Valid Until</span>
          <span class="row-value">${validUntil}</span>
        </div>
        <hr class="divider"/>
        <div class="row">
          <span class="row-label">Payment ID</span>
          <span class="row-value">${sub.razorpay_payment_id || '—'}</span>
        </div>
        <div class="row">
          <span class="row-label">Order ID</span>
          <span class="row-value">${sub.razorpay_order_id || '—'}</span>
        </div>
        <hr class="divider"/>
        <div class="row">
          <span class="row-label">Billed To</span>
          <span class="row-value">${req.user.email}</span>
        </div>
        <div class="row">
          <span class="row-label">Status</span>
          <span class="row-value" style="color:#22c55e;font-weight:700;">Paid</span>
        </div>
      </div>
      <button class="print-btn" onclick="window.print()">Download / Print Receipt</button>
    </div>
    <div class="footer">
      <p>SnapLivo · <a href="mailto:support@snaplivo.in">support@snaplivo.in</a><br/>
      This is a payment confirmation receipt. For queries, contact support.</p>
    </div>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('GET /billing/receipt/:id', err);
    res.status(500).json({ error: 'Failed to generate receipt' });
  }
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
      'max_face_scans_per_event',
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
