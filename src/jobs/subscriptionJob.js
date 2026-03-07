const cron = require('node-cron');
const { Op, fn, col } = require('sequelize');
const { Subscription, Plan, User, Photo } = require('../models');
const { sendNotification } = require('../services/notificationService');
const {
  sendSubscriptionExpiryWarning,
  sendGracePeriodExpiredEmail,
} = require('../services/emailService');

async function runSubscriptionJob() {
  const now = new Date();

  // ── 1. Subscription expiry warnings (7 days before end_date) ──────────────
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const windowStart = new Date(in7Days.getTime() - 60 * 60 * 1000);
  const windowEnd   = new Date(in7Days.getTime() + 60 * 60 * 1000);

  const expiringSoon = await Subscription.findAll({
    where: {
      status: 'active',
      end_date: { [Op.between]: [windowStart, windowEnd] },
    },
    include: [
      { model: User, attributes: ['id', 'email', 'name'] },
      { model: Plan, foreignKey: 'plan_key', as: 'Plan', attributes: ['name'] },
    ],
  });

  for (const sub of expiringSoon) {
    const planName = sub.Plan?.name || sub.plan_key;
    await sendNotification({
      userId: sub.user_id,
      type: 'subscription_expiring',
      title: 'Plan Expiring Soon',
      body: `Your ${planName} plan expires in 7 days. Renew now to keep your features active.`,
      data: { screen: 'billing_status' },
    }).catch(() => {});
    if (sub.User?.email) {
      await sendSubscriptionExpiryWarning(sub.User.email, planName, sub.end_date).catch(() => {});
    }
    console.log(`[SubJob] Expiry warning sent for user ${sub.user_id} (plan: ${planName})`);
  }

  // ── 2. Grace period expiry enforcement ────────────────────────────────────
  const expiredGrace = await Subscription.findAll({
    where: {
      status: 'grace_period',
      grace_until: { [Op.lte]: now },
    },
    include: [{ model: User, attributes: ['id', 'email'] }],
  });

  for (const sub of expiredGrace) {
    await sub.update({ status: 'expired' });
    await User.update({ subscription_plan: 'free' }, { where: { id: sub.user_id } });
    await sendNotification({
      userId: sub.user_id,
      type: 'subscription_expired',
      title: 'Subscription Ended',
      body: 'Your grace period has ended. Your account has been downgraded to the Free plan.',
      data: { screen: 'billing_status' },
    }).catch(() => {});
    if (sub.User?.email) {
      await sendGracePeriodExpiredEmail(sub.User.email).catch(() => {});
    }
    console.log(`[SubJob] Grace period expired for user ${sub.user_id} — downgraded to free`);
  }

  // ── 3. Storage 80% full notifications ─────────────────────────────────────
  // Find all organizers with an active paid subscription
  const activeSubscriptions = await Subscription.findAll({
    where: { status: 'active' },
    include: [
      { model: User, attributes: ['id', 'email', 'subscription_plan'] },
      { model: Plan, foreignKey: 'plan_key', as: 'Plan', attributes: ['name', 'max_storage_mb'] },
    ],
  });

  for (const sub of activeSubscriptions) {
    if (!sub.Plan || !sub.User) continue;
    const limitBytes = sub.Plan.max_storage_mb * 1024 * 1024;
    if (limitBytes === 0) continue;

    const row = await Photo.findOne({
      where: { uploader_id: sub.user_id, status: 'uploaded' },
      attributes: [[fn('SUM', col('file_size')), 'total']],
      raw: true,
    });
    const usedBytes = parseInt(row?.total || 0);
    const pct = usedBytes / limitBytes;

    if (pct >= 0.8 && pct < 1.0) {
      const usedGb = (usedBytes / (1024 * 1024 * 1024)).toFixed(1);
      const limitGb = (sub.Plan.max_storage_mb / 1024).toFixed(0);
      await sendNotification({
        userId: sub.user_id,
        type: 'storage_warning',
        title: 'Storage Almost Full',
        body: `You've used ${usedGb} GB of your ${limitGb} GB limit. Upgrade to avoid interruptions.`,
        data: { screen: 'billing_status' },
      }).catch(() => {});
      console.log(`[SubJob] Storage 80% warning sent for user ${sub.user_id} (${Math.round(pct * 100)}%)`);
    }
  }
}

function startSubscriptionJob() {
  // Run at 9 AM every day
  cron.schedule('0 9 * * *', () => {
    console.log('[SubJob] Running subscription checks...');
    runSubscriptionJob().catch((err) => console.error('[SubJob] Error:', err.message));
  });
  console.log('[SubJob] Scheduled — runs daily at 9 AM');
}

module.exports = { startSubscriptionJob, runSubscriptionJob };
