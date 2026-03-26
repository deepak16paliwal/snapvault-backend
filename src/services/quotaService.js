const { Plan, Photo, User } = require('../models');
const { Op, fn, col } = require('sequelize');

async function getPlanLimits(planKey) {
  const plan = await Plan.findOne({ where: { plan_key: planKey, is_active: true } });
  if (!plan) {
    return Plan.findOne({ where: { plan_key: 'free' } });
  }
  return plan;
}

async function checkQuota(user, mimeType) {
  const limits = await getPlanLimits(user.subscription_plan || 'free');
  if (!limits) return { allowed: true }; // fail open if DB issue

  const isVideo = mimeType && mimeType.startsWith('video/');

  if (isVideo) {
    if (limits.max_videos === 0) {
      return {
        allowed: false,
        reason: `Your ${limits.name} plan does not support video uploads. Upgrade to Basic or higher.`,
      };
    }
    // Count only active (non-deleted) videos
    const videoCount = await Photo.count({
      where: { uploader_id: user.id, status: 'uploaded', soft_deleted_at: null, mime_type: { [Op.like]: 'video/%' } },
    });
    if (videoCount >= limits.max_videos) {
      return {
        allowed: false,
        reason: `You've reached your ${limits.name} plan limit of ${limits.max_videos} videos. Upgrade to continue.`,
      };
    }
  } else {
    // Count only active (non-deleted) photos
    const photoCount = await Photo.count({
      where: { uploader_id: user.id, status: 'uploaded', soft_deleted_at: null },
    });
    if (photoCount >= limits.max_photos) {
      return {
        allowed: false,
        reason: `You've reached your ${limits.name} plan limit of ${limits.max_photos} photos. Upgrade to continue.`,
      };
    }
  }

  // Storage quota: use cumulative counter — never decremented on delete
  const storageLimitBytes = limits.max_storage_mb * 1024 * 1024;
  const freshUser = await User.findByPk(user.id, { attributes: ['storage_consumed_bytes'] });
  const usedBytes = parseInt(freshUser?.storage_consumed_bytes || 0);
  if (usedBytes >= storageLimitBytes) {
    const limitGb = limits.max_storage_mb >= 1024
      ? `${(limits.max_storage_mb / 1024).toFixed(0)} GB`
      : `${limits.max_storage_mb} MB`;
    return {
      allowed: false,
      reason: `You've used all ${limitGb} of storage on your ${limits.name} plan. Upgrade to continue uploading.`,
    };
  }

  return { allowed: true };
}

// Returns cumulative consumed bytes (for dashboard display)
async function getStorageUsed(userId) {
  const user = await User.findByPk(userId, { attributes: ['storage_consumed_bytes'] });
  return parseInt(user?.storage_consumed_bytes || 0);
}

module.exports = { checkQuota, getPlanLimits, getStorageUsed };
