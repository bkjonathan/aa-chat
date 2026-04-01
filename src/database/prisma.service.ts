import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly configService: ConfigService) {
    const connectionString = configService.get<string>('database.url');
    const adapter = new PrismaPg({ connectionString });
    super({
      adapter,
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');

    // Log slow queries in development
    if (this.configService.get<string>('app.nodeEnv') === 'development') {
      (this as any).$on('query', (e: any) => {
        if (e.duration > 500) {
          this.logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
        }
      });
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }

  // Helper: clean database for testing
  async cleanDatabase() {
    if (this.configService.get<string>('app.nodeEnv') === 'production') {
      throw new Error('cleanDatabase() cannot run in production');
    }
    const tableNames = await this.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname='public'
      AND tablename NOT LIKE '_prisma%'
    `;
    for (const { tablename } of tableNames) {
      await this.$executeRawUnsafe(
        `TRUNCATE TABLE "${tablename}" RESTART IDENTITY CASCADE`,
      );
    }
  }
}
