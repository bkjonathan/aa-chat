import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { LoggerModule } from './common/logger/logger.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RoomsModule } from './room/rooms.module';
import { MessagesModule } from './messages/messages.module';
import { GatewayModule } from './gateway/gateway.module';
import { FilesModule } from './files/files.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SearchModule } from './search/search.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { buildThrottlerConfig } from './common/throttler/throttler.config';
import { envValidationSchema } from './config/env.validation';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import redisConfig from './config/redis.config';
import awsConfig from './config/aws.config';
import pushConfig from './config/push.config';
import elasticsearchConfig from './config/elasticsearch.config';

@Module({
  imports: [
    // ── Config (global) ──────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        jwtConfig,
        redisConfig,
        awsConfig,
        pushConfig,
        elasticsearchConfig,
      ],
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
      envFilePath: ['.env.local', '.env'],
    }),

    // ── Rate limiting ────────────────────────────────
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: buildThrottlerConfig(),
      }),
    }),

    // ── Event emitter ────────────────────────────────
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
      ignoreErrors: false,
    }),

    // ── Infrastructure ───────────────────────────────
    LoggerModule,
    DatabaseModule,
    RedisModule,

    // ── Feature modules ──────────────────────────────
    HealthModule,
    AuthModule,
    UsersModule,
    RoomsModule,
    MessagesModule,
    GatewayModule,
    FilesModule,
    NotificationsModule,
    SearchModule,
  ],

  providers: [
    // Global JWT guard — @Public() to bypass
    { provide: APP_GUARD, useClass: JwtAuthGuard },

    // Global throttler guard
    { provide: APP_GUARD, useClass: ThrottlerGuard },

    // Global exception filter
    { provide: APP_FILTER, useClass: AllExceptionsFilter },

    // Global logging interceptor
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
