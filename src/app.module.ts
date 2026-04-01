import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import redisConfig from './config/redis.config';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RoomsModule } from './room/rooms.module';
import { GatewayModule } from './gateway/gateway.module';
import { MessagesModule } from './messages/messages.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig, redisConfig],
      envFilePath: '.env',
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    UsersModule,
    RoomsModule,
    MessagesModule,
    RedisModule,
    GatewayModule,
    // Phase 2+: AuthModule, UsersModule, RoomsModule, etc.
  ],
  providers: [
    // Apply JWT guard globally — use @Public() to opt out
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
