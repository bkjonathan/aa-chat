import { ThrottlerOptions } from '@nestjs/throttler';

// ─── Named rate limit tiers ───────────────────────────

export const THROTTLE_TIERS = {
  // Very strict: auth endpoints
  AUTH: 'auth',
  // Strict: write operations
  WRITE: 'write',
  // Standard: general API
  DEFAULT: 'default',
  // Relaxed: read operations
  READ: 'read',
} as const;

export function buildThrottlerConfig(): ThrottlerOptions[] {
  return [
    {
      name: THROTTLE_TIERS.AUTH,
      ttl: 15 * 60 * 1000, // 15 minutes
      limit: 10, // 10 attempts per 15 min
    },
    {
      name: THROTTLE_TIERS.WRITE,
      ttl: 60 * 1000, // 1 minute
      limit: 30, // 30 writes per minute
    },
    {
      name: THROTTLE_TIERS.DEFAULT,
      ttl: 60 * 1000, // 1 minute
      limit: 100, // 100 requests per minute
    },
    {
      name: THROTTLE_TIERS.READ,
      ttl: 60 * 1000, // 1 minute
      limit: 300, // 300 reads per minute
    },
  ];
}
