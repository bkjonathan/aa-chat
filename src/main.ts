import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { ServerOptions } from 'socket.io';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import helmet from 'helmet';
import compression from 'compression';
import hpp from 'hpp';
import Redis from 'ioredis';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

import { setupSwagger } from './common/swagger/swagger.setup';

// ─── Redis Socket.io adapter ──────────────────────────

class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;

  async connectToRedis(configService: ConfigService): Promise<void> {
    const options = {
      host: configService.get<string>('redis.host'),
      port: configService.get<number>('redis.port'),
      password: configService.get<string>('redis.password') || undefined,
    };

    const pubClient = new Redis(options);
    const subClient = pubClient.duplicate();

    await Promise.all([
      new Promise<void>((res) => pubClient.once('ready', res)),
      new Promise<void>((res) => subClient.once('ready', res)),
    ]);

    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }
}

// ─── Bootstrap ────────────────────────────────────────

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true, // buffer logs until Winston is ready
  });

  // ── Use Winston as the NestJS logger ───────────────
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') ?? 3000;
  const nodeEnv = configService.get<string>('app.nodeEnv');
  const frontendUrl = configService.get<string>('app.frontendUrl');
  const isProd = nodeEnv === 'production';

  // ── Redis Socket.io adapter ────────────────────────
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis(configService);
  app.useWebSocketAdapter(redisIoAdapter);

  // ── Security headers ───────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: isProd
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'https:'],
              connectSrc: ["'self'", 'wss:', 'https:'],
              fontSrc: ["'self'", 'https:'],
              objectSrc: ["'none'"],
              mediaSrc: ["'self'"],
              frameSrc: ["'none'"],
            },
          }
        : false, // disable CSP in dev so Swagger UI works
      crossOriginEmbedderPolicy: isProd,
      hsts: isProd
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    }),
  );

  // ── Prevent HTTP parameter pollution ──────────────
  app.use(hpp());

  // ── Response compression ───────────────────────────
  app.use(
    compression({
      filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
      },
      level: 6, // zlib compression level (0-9)
      threshold: 1024, // only compress responses > 1KB
    }),
  );

  // ── CORS ───────────────────────────────────────────
  app.enableCors({
    origin: (origin, callback) => {
      const allowedOrigins = [
        frontendUrl,
        'http://localhost:3001',
        'http://localhost:3000',
      ].filter(Boolean);

      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: ${origin}`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-request-id',
      'x-no-compression',
    ],
    exposedHeaders: [
      'x-request-id',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
    ],
    maxAge: 86400, // preflight cache 24h
  });

  // ── Global prefix (HTTP only, exclude WS) ─────────
  app.setGlobalPrefix('api/v1', {
    exclude: ['/socket.io/*path'],
  });

  // ── Global validation pipe ─────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      disableErrorMessages: isProd,
      stopAtFirstError: false,
    }),
  );

  // ── Global interceptors ────────────────────────────
  app.useGlobalInterceptors(new TransformInterceptor());

  // ── Swagger (dev + staging only) ───────────────────
  if (!isProd) {
    setupSwagger(app);
  }

  // ── Graceful shutdown ──────────────────────────────
  app.enableShutdownHooks();
  process.on('SIGTERM', async () => {
    await app.close();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    await app.close();
    process.exit(0);
  });

  await app.listen(port, '0.0.0.0');

  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
  logger.log(
    `Application running in ${nodeEnv} mode on http://0.0.0.0:${port}/api/v1`,
    'Bootstrap',
  );
  if (!isProd) {
    logger.log(`Swagger docs: http://localhost:${port}/api/docs`, 'Bootstrap');
  }
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
