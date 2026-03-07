const cron = require('node-cron');
const { Op } = require('sequelize');
const { Event, Photo } = require('../models');
const { sendNotification } = require('../services/notificationService');
const { deleteFile } = require('../services/s3Service');

async function runExpiryJob() {
  const now = new Date();

  // 1. Expire events past their expiry date — mark inactive + record soft_deleted_at
  const expired = await Event.findAll({
    where: { expires_at: { [Op.lte]: now }, is_active: true },
  });

  for (const event of expired) {
    await event.update({ is_active: false, soft_deleted_at: now });
    await sendNotification({
      userId: event.organizer_id,
      type: 'event_expired',
      title: 'Event Expired',
      body: `Your event "${event.title}" has expired and is now hidden from attendees.`,
      data: { event_id: String(event.id), screen: 'events' },
    }).catch(() => {});
    console.log(`[ExpiryJob] Event ${event.id} "${event.title}" soft-deleted`);
  }

  // 2. 7-day warning: expires_at falls within a ±1h window around 7 days from now
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const windowStart = new Date(in7Days.getTime() - 60 * 60 * 1000);
  const windowEnd   = new Date(in7Days.getTime() + 60 * 60 * 1000);

  const expiringSoon = await Event.findAll({
    where: {
      expires_at: { [Op.between]: [windowStart, windowEnd] },
      is_active: true,
    },
  });

  for (const event of expiringSoon) {
    await sendNotification({
      userId: event.organizer_id,
      type: 'event_expiring_soon',
      title: 'Event Expiring Soon',
      body: `Your event "${event.title}" expires in 7 days. Extend the expiry date to keep it active.`,
      data: { event_id: String(event.id), screen: 'events' },
    }).catch(() => {});
    console.log(`[ExpiryJob] 7-day warning sent for event ${event.id}`);
  }

  // 3. Permanent deletion: events soft-deleted > 60 days ago
  const cutoff = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const toDelete = await Event.findAll({
    where: {
      soft_deleted_at: { [Op.ne]: null, [Op.lte]: cutoff },
      is_active: false,
    },
    include: [{ model: Photo, attributes: ['id', 's3_key', 'thumbnail_key'] }],
  });

  for (const event of toDelete) {
    for (const photo of event.Photos || []) {
      if (photo.s3_key) await deleteFile(photo.s3_key).catch(() => {});
      if (photo.thumbnail_key) await deleteFile(photo.thumbnail_key).catch(() => {});
    }
    await Photo.destroy({ where: { event_id: event.id } });
    await event.destroy();
    console.log(`[ExpiryJob] Event ${event.id} permanently deleted (60-day grace elapsed)`);
  }
}

function startExpiryJob() {
  // Run at midnight every day
  cron.schedule('0 0 * * *', () => {
    console.log('[ExpiryJob] Running event expiry check...');
    runExpiryJob().catch((err) => console.error('[ExpiryJob] Error:', err.message));
  });
  console.log('[ExpiryJob] Scheduled — runs daily at midnight');
}

module.exports = { startExpiryJob, runExpiryJob };
