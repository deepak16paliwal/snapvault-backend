const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const sharp = require('sharp');
const s3 = require('../config/s3');
const env = require('../config/env');

const BUCKET = env.aws.s3Bucket;

// Generate a presigned URL for direct client-side upload (PUT)
async function getUploadUrl(s3Key, mimeType) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    ContentType: mimeType,
  });
  return getSignedUrl(s3, command, { expiresIn: 15 * 60 }); // 15 min
}

// Generate a presigned URL for downloading/viewing a file (GET)
async function getDownloadUrl(s3Key) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: s3Key });
  return getSignedUrl(s3, command, { expiresIn: 60 * 60 }); // 1 hour
}

// Download a file from S3 as a Buffer
async function downloadBuffer(s3Key) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: s3Key });
  const response = await s3.send(command);
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Upload a buffer directly to S3
async function uploadBuffer(s3Key, buffer, mimeType) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    Body: buffer,
    ContentType: mimeType,
  });
  return s3.send(command);
}

// Delete a file from S3
async function deleteFile(s3Key) {
  try {
    const command = new DeleteObjectCommand({ Bucket: BUCKET, Key: s3Key });
    await s3.send(command);
  } catch (_) {
    // Ignore if file doesn't exist
  }
}

// Generate thumbnail: download original, resize to 400px wide, upload thumbnail
async function generateThumbnail(originalKey, thumbnailKey) {
  const original = await downloadBuffer(originalKey);
  const thumbnail = await sharp(original)
    .resize({ width: 400, withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  await uploadBuffer(thumbnailKey, thumbnail, 'image/jpeg');
}

// Generate a watermarked copy of a thumbnail and upload it to wmKey.
// watermarkText: defaults to 'SnapVault'; pass organizer name for premium plans.
async function generateWatermarkedThumbnail(thumbnailKey, wmKey, watermarkText = 'SnapVault') {
  const buffer = await downloadBuffer(thumbnailKey);
  const { width = 400, height = 400 } = await sharp(buffer).metadata();

  const fontSize = Math.max(18, Math.floor(Math.min(width, height) / 8));
  const cx = width / 2;
  const cy = height / 2;
  const safeText = String(watermarkText).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <text
      x="${cx}" y="${cy}"
      text-anchor="middle"
      dominant-baseline="middle"
      fill="rgba(255,255,255,0.50)"
      stroke="rgba(0,0,0,0.18)"
      stroke-width="1"
      font-size="${fontSize}"
      font-family="Arial, Helvetica, sans-serif"
      font-weight="bold"
      transform="rotate(-30 ${cx} ${cy})"
    >${safeText}</text>
  </svg>`;

  let watermarked;
  try {
    watermarked = await sharp(buffer)
      .composite([{ input: Buffer.from(svg), gravity: 'center' }])
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch (err) {
    throw new Error(`Sharp SVG composite failed for ${wmKey}: ${err.message}`);
  }

  await uploadBuffer(wmKey, watermarked, 'image/jpeg');
}

// Convert a stored S3 https URL to a presigned GET URL.
// Returns null for null/empty input, returns the original URL if it can't be parsed.
async function presignStoredUrl(url) {
  if (!url) return null;
  try {
    const match = url.match(/\.amazonaws\.com\/(.+)$/);
    if (!match) return url;
    return await getDownloadUrl(match[1]);
  } catch (_) {
    return url;
  }
}

module.exports = {
  getUploadUrl,
  getDownloadUrl,
  generateThumbnail,
  generateWatermarkedThumbnail,
  deleteFile,
  presignStoredUrl,
};
