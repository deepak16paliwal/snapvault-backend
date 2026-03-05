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

module.exports = {
  getUploadUrl,
  getDownloadUrl,
  generateThumbnail,
  deleteFile,
};
