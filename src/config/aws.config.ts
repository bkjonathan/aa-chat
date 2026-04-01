import { registerAs } from '@nestjs/config';

export default registerAs('aws', () => ({
  region: process.env.AWS_REGION || 'ap-southeast-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  s3Bucket: process.env.AWS_S3_BUCKET || 'chatapp-files',
  s3PresignedUrlExpiry: 3600, // seconds
  cloudFrontUrl: process.env.CLOUDFRONT_URL || null,
}));
