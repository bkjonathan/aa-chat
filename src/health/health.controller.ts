import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { Public } from 'src/auth/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prismaHealth: PrismaHealthIndicator,
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma),
      async (): Promise<HealthIndicatorResult> => {
        try {
          await this.redis.getClient().ping();
          return { redis: { status: 'up' } };
        } catch {
          return { redis: { status: 'down' } };
        }
      },
    ]);
  }

  @Public()
  @Get('ping')
  ping() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
