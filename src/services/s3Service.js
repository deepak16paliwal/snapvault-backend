const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const sharp = require('sharp');
const s3 = require('../config/s3');
const env = require('../config/env');

const BUCKET = env.r2.bucket;

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
async function getDownloadUrl(s3Key, expiresIn = 60 * 60) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: s3Key });
  return getSignedUrl(s3, command, { expiresIn }); // default 1 hour
}

// Download a file from R2 as a Buffer
async function downloadBuffer(s3Key) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: s3Key });
  const response = await s3.send(command);
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Upload a buffer directly to R2
async function uploadBuffer(s3Key, buffer, mimeType) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    Body: buffer,
    ContentType: mimeType,
  });
  return s3.send(command);
}

// Delete a file from R2
async function deleteFile(s3Key) {
  try {
    const command = new DeleteObjectCommand({ Bucket: BUCKET, Key: s3Key });
    await s3.send(command);
  } catch (_) {
    // Ignore if file doesn't exist
  }
}

// Generate WebP thumbnail: download original, resize to 400px wide, upload as .webp
async function generateThumbnail(originalKey, thumbnailKey) {
  const original = await downloadBuffer(originalKey);
  const thumbnail = await sharp(original)
    .resize({ width: 400, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
  await uploadBuffer(thumbnailKey, thumbnail, 'image/webp');
}

/**
 * Compute a difference hash (dHash) for duplicate detection.
 * Resizes to 9x8 greyscale, compares adjacent pixels per row → 64-bit hex string.
 * Uses Sharp only — no additional dependency.
 * @param {Buffer} buffer - Image buffer
 * @returns {Promise<string>} 16-character hex hash
 */
async function computeImageHash(buffer) {
  const { data } = await sharp(buffer)
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = BigInt(0);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = data[row * 9 + col];
      const right = data[row * 9 + col + 1];
      bits = (bits << BigInt(1)) | BigInt(left > right ? 1 : 0);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

// Handles both plain storage keys and legacy full S3 URLs stored in DB
const presignStoredUrl = (value, expiresIn = 3600) => {
  if (!value) return Promise.resolve(null);
  if (value.startsWith('http')) {
    try {
      const key = new URL(value).pathname.replace(/^\//, '');
      return getDownloadUrl(key, expiresIn);
    } catch (_) {}
  }
  return getDownloadUrl(value, expiresIn);
};

module.exports = {
  getUploadUrl,
  getDownloadUrl,
  presignStoredUrl,
  generateThumbnail,
  deleteFile,
  downloadBuffer,
  uploadBuffer,
  computeImageHash,
};
