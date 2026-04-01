import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../database/prisma.service';
import { UserStatus } from '@prisma/client';

export interface PresenceData {
  userId: string;
  status: UserStatus;
  lastSeenAt: string;
  socketCount: number;
}

const PRESENCE_TTL = 35; // seconds — refreshed every 30s by heartbeat

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(
    private redis: RedisService,
    private prisma: PrismaService,
  ) {}

  // ─── Connect ─────────────────────────────────────────

  async userConnected(userId: string, socketId: string): Promise<void> {
    const now = new Date().toISOString();

    // Track socket → user mapping
    await this.redis.set(
      this.redis.socketUserKey(socketId),
      userId,
      PRESENCE_TTL + 60,
    );

    // Track user → sockets set
    await this.redis.sadd(this.redis.userSocketsKey(userId), socketId);

    // Set presence with TTL
    await this.redis.set(
      this.redis.presenceKey(userId),
      JSON.stringify({ userId, status: 'online', lastSeenAt: now }),
      PRESENCE_TTL,
    );

    // Update DB status
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.online, lastSeenAt: new Date() },
    });
  }

  // ─── Disconnect ──────────────────────────────────────

  async userDisconnected(
    userId: string,
    socketId: string,
  ): Promise<{ wentOffline: boolean }> {
    // Remove this socket from user's socket set
    await this.redis.srem(this.redis.userSocketsKey(userId), socketId);
    await this.redis.del(this.redis.socketUserKey(socketId));

    const remainingSockets = await this.redis.scard(
      this.redis.userSocketsKey(userId),
    );

    if (remainingSockets === 0) {
      // No more active sockets — user is offline
      await this.redis.del(this.redis.presenceKey(userId));

      await this.prisma.user.update({
        where: { id: userId },
        data: { status: UserStatus.offline, lastSeenAt: new Date() },
      });

      return { wentOffline: true };
    }

    return { wentOffline: false };
  }

  // ─── Heartbeat (called every 30s from client) ────────

  async heartbeat(userId: string): Promise<void> {
    await this.redis.expire(this.redis.presenceKey(userId), PRESENCE_TTL);
  }

  // ─── Status update ───────────────────────────────────

  async setStatus(userId: string, status: UserStatus): Promise<void> {
    const existing = await this.redis.get(this.redis.presenceKey(userId));
    if (!existing) return; // User not connected

    const data = JSON.parse(existing);
    await this.redis.set(
      this.redis.presenceKey(userId),
      JSON.stringify({ ...data, status }),
      PRESENCE_TTL,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { status },
    });
  }

  // ─── Get presence ────────────────────────────────────

  async getPresence(userId: string): Promise<PresenceData | null> {
    const raw = await this.redis.get(this.redis.presenceKey(userId));
    if (!raw) return null;

    const socketCount = await this.redis.scard(
      this.redis.userSocketsKey(userId),
    );

    return { ...JSON.parse(raw), socketCount };
  }

  async getManyPresence(
    userIds: string[],
  ): Promise<Record<string, PresenceData | null>> {
    const result: Record<string, PresenceData | null> = {};

    await Promise.all(
      userIds.map(async (id) => {
        result[id] = await this.getPresence(id);
      }),
    );

    return result;
  }

  async isOnline(userId: string): Promise<boolean> {
    return this.redis.exists(this.redis.presenceKey(userId));
  }

  // ─── Resolve userId from socketId ────────────────────

  async getUserIdFromSocket(socketId: string): Promise<string | null> {
    return this.redis.get(this.redis.socketUserKey(socketId));
  }
}
