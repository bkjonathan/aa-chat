import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  PrismaHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ElasticsearchService } from '../search/elasticsearch.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prismaHealth: PrismaHealthIndicator,
    private memoryHealth: MemoryHealthIndicator,
    private diskHealth: DiskHealthIndicator,
    private prisma: PrismaService,
    private redis: RedisService,
    private elasticsearchService: ElasticsearchService,
  ) {}

  // ─── Full health check ────────────────────────────────

  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Full health check (all services)' })
  check() {
    return this.health.check([
      // Database
      () => this.prismaHealth.pingCheck('postgres', this.prisma),

      // Redis
      async () => {
        try {
          const pong = await this.redis.getClient().ping();
          const status = pong === 'PONG' ? 'up' : 'down';
          return { redis: { status } };
        } catch {
          return { redis: { status: 'down' } };
        }
      },

      // Elasticsearch (non-critical)
      async (): Promise<HealthIndicatorResult> => {
        try {
          if (!this.elasticsearchService.isEnabled()) {
            return { elasticsearch: { status: 'up', message: 'disabled' } };
          }
          await this.elasticsearchService
            .getClient()
            .cluster.health({ timeout: '3s' });
          return { elasticsearch: { status: 'up' } };
        } catch {
          return { elasticsearch: { status: 'down', message: 'degraded' } };
        }
      },

      // Memory: heap used < 512 MB
      () => this.memoryHealth.checkHeap('memory_heap', 512 * 1024 * 1024),

      // Memory: RSS < 1 GB
      () => this.memoryHealth.checkRSS('memory_rss', 1024 * 1024 * 1024),

      // Disk: usage < 90%
      () =>
        this.diskHealth.checkStorage('disk', {
          path: '/',
          thresholdPercent: 0.9,
        }),
    ]);
  }

  // ─── Lightweight liveness probe (for k8s / load balancers)

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — is the process alive?' })
  liveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      pid: process.pid,
    };
  }

  // ─── Readiness probe (for k8s — is DB reachable?) ────

  @Public()
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe — is the app ready to serve?' })
  readiness() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('postgres', this.prisma),
      async () => {
        const pong = await this.redis.getClient().ping();
        return { redis: { status: pong === 'PONG' ? 'up' : 'down' } };
      },
    ]);
  }

  // ─── Quick ping ───────────────────────────────────────

  @Public()
  @Get('ping')
  @ApiOperation({ summary: 'Quick ping — no dependency checks' })
  ping() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
