import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { THROTTLE_TIERS } from './throttler.config';

// Convenience decorators for each tier
export const ThrottleAuth = () =>
  Throttle({ [THROTTLE_TIERS.AUTH]: { ttl: 15 * 60 * 1000, limit: 10 } });

export const ThrottleWrite = () =>
  Throttle({ [THROTTLE_TIERS.WRITE]: { ttl: 60 * 1000, limit: 30 } });

export const ThrottleRead = () =>
  Throttle({ [THROTTLE_TIERS.READ]: { ttl: 60 * 1000, limit: 300 } });

export { SkipThrottle };
