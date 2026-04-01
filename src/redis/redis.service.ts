import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;
  private subscriber: Redis;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const options = {
      host: this.configService.get<string>('redis.host'),
      port: this.configService.get<number>('redis.port'),
      password: this.configService.get<string>('redis.password') || undefined,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
      lazyConnect: false,
    };

    this.client = new Redis(options);
    this.subscriber = new Redis(options);

    this.client.on('connect', () => this.logger.log('Redis client connected'));
    this.client.on('error', (err) =>
      this.logger.error('Redis client error', err),
    );
    this.subscriber.on('connect', () =>
      this.logger.log('Redis subscriber connected'),
    );
  }

  async onModuleDestroy() {
    await this.client.quit();
    await this.subscriber.quit();
  }

  // ─── Expose raw clients for socket.io adapter ────────

  getClient(): Redis {
    return this.client;
  }

  getSubscriber(): Redis {
    return this.subscriber;
  }

  // ─── Generic key-value ops ───────────────────────────

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) await this.client.del(...keys);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds);
  }

  // ─── Hash ops (for presence maps) ───────────────────

  async hset(key: string, field: string, value: string): Promise<void> {
    await this.client.hset(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async hdel(key: string, field: string): Promise<void> {
    await this.client.hdel(key, field);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  // ─── Set ops (for socket-to-user mapping) ────────────

  async sadd(key: string, ...members: string[]): Promise<void> {
    await this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<void> {
    await this.client.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async scard(key: string): Promise<number> {
    return this.client.scard(key);
  }

  // ─── Presence helpers ────────────────────────────────

  presenceKey(userId: string): string {
    return `presence:user:${userId}`;
  }

  userSocketsKey(userId: string): string {
    return `sockets:user:${userId}`;
  }

  socketUserKey(socketId: string): string {
    return `socket:user:${socketId}`;
  }
}
