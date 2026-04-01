import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import Redis from 'ioredis';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { ServerOptions } from 'socket.io';
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

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') ?? 3000;
  const frontendUrl = configService.get<string>('app.frontendUrl');

  // Redis Socket.io adapter
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis(configService);
  app.useWebSocketAdapter(redisIoAdapter);

  // Security
  app.use(helmet());

  // CORS
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Global prefix for HTTP only (WebSocket routes are handled by the adapter, not the HTTP router)
  app.setGlobalPrefix('api/v1');

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global response transform
  app.useGlobalInterceptors(new TransformInterceptor());

  // Add this block in bootstrap(), before await app.listen(port)
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Chat App API')
    .setDescription('NestJS Chat Application REST API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  logger.log(`Swagger docs: http://localhost:${port}/api/docs`);

  await app.listen(port);
  logger.log(`Application running on http://localhost:${port}/api/v1`);
  logger.log(`Health check: http://localhost:${port}/api/v1/health`);
  logger.log(`WebSocket: ws://localhost:${port}`);
}

void bootstrap();
