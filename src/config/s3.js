const { S3Client } = require('@aws-sdk/client-s3');
const env = require('./env');

// Cloudflare R2 — S3-compatible, zero egress cost
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.r2.accessKeyId,
    secretAccessKey: env.r2.secretAccessKey,
  },
  // Disable automatic checksum injection on presigned PUT URLs.
  // Without this, SDK v3 adds x-amz-checksum-crc32 to presigned URLs,
  // which browsers cannot satisfy since they don't know the checksum before upload.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

module.exports = s3;
