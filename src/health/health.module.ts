import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [
    TerminusModule.forRoot({
      errorLogStyle: 'pretty',
      gracefulShutdownTimeoutMs: 5000,
    }),
    DatabaseModule,
    RedisModule,
    SearchModule,
  ],
  controllers: [HealthController],
})
export class HealthModule {}
