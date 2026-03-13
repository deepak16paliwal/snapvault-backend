const { S3Client } = require('@aws-sdk/client-s3');
const env = require('./env');

const s3 = new S3Client({
  region: env.aws.region,
  credentials: {
    accessKeyId: env.aws.accessKeyId,
    secretAccessKey: env.aws.secretAccessKey,
  },
  // Disable automatic checksum injection on presigned PUT URLs.
  // Without this, SDK v3 adds x-amz-checksum-crc32 to presigned URLs,
  // which browsers cannot satisfy since they don't know the checksum before upload.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

module.exports = s3;
