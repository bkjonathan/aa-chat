import {
  Injectable,
  Logger,
  OnModuleInit,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';
import { Prisma, DeviceType } from '@prisma/client';
import * as webpush from 'web-push';

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, any>;
  actions?: { action: string; title: string }[];
}

@Injectable()
export class PushNotificationsService implements OnModuleInit {
  private readonly logger = new Logger(PushNotificationsService.name);
  private vapidPublicKey: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  onModuleInit() {
    this.vapidPublicKey =
      this.configService.get<string>('push.vapidPublicKey') ?? '';
    const vapidPrivateKey =
      this.configService.get<string>('push.vapidPrivateKey') ?? '';
    const vapidSubject =
      this.configService.get<string>('push.vapidSubject') ?? '';

    if (!this.vapidPublicKey || !vapidPrivateKey) {
      this.logger.warn(
        'VAPID keys not configured — push notifications disabled',
      );
      return;
    }

    webpush.setVapidDetails(vapidSubject, this.vapidPublicKey, vapidPrivateKey);
    this.logger.log('Web Push initialised with VAPID keys');
  }

  // ─── Get VAPID public key (for browser subscription) ──

  getVapidPublicKey(): string {
    return this.vapidPublicKey;
  }

  // ─── Subscribe ────────────────────────────────────────

  async subscribe(userId: string, dto: SubscribePushDto) {
    try {
      const subscription = await this.prisma.pushSubscription.upsert({
        where: { endpoint: dto.endpoint },
        update: {
          p256dhKey: dto.keys.p256dh,
          authKey: dto.keys.auth,
          isActive: true,
          lastUsedAt: new Date(),
          deviceType: dto.deviceType ?? DeviceType.web,
          userAgent: dto.userAgent,
        },
        create: {
          userId,
          endpoint: dto.endpoint,
          p256dhKey: dto.keys.p256dh,
          authKey: dto.keys.auth,
          deviceType: dto.deviceType ?? DeviceType.web,
          userAgent: dto.userAgent,
        },
      });

      this.logger.log(
        `Push subscription saved for user ${userId}: ${dto.deviceType}`,
      );
      return subscription;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Subscription already registered');
      }
      throw e;
    }
  }

  // ─── Unsubscribe ──────────────────────────────────────

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.updateMany({
      where: { userId, endpoint },
      data: { isActive: false },
    });
  }

  async unsubscribeAll(userId: string): Promise<void> {
    await this.prisma.pushSubscription.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });
  }

  // ─── Send push to a single user (all their devices) ───

  async sendToUser(
    userId: string,
    payload: PushPayload,
  ): Promise<{ sent: number; failed: number }> {
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId, isActive: true },
    });

    if (subscriptions.length === 0) {
      return { sent: 0, failed: 0 };
    }

    const results = await Promise.allSettled(
      subscriptions.map((sub) => this.sendToSubscription(sub, payload)),
    );

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        sent++;
        // Update last used timestamp
        await this.prisma.pushSubscription
          .update({
            where: { id: subscriptions[i].id },
            data: { lastUsedAt: new Date() },
          })
          .catch(() => {});
      } else {
        failed++;
        this.logger.warn(
          `Push failed for subscription ${subscriptions[i].id}: ${result.reason}`,
        );
      }
    }

    return { sent, failed };
  }

  // ─── Fan-out: send to multiple users ─────────────────

  async sendToUsers(userIds: string[], payload: PushPayload): Promise<void> {
    // Fire and forget — don't await
    userIds.forEach((userId) => {
      this.sendToUser(userId, payload).catch((err) =>
        this.logger.error(`Push fan-out failed for ${userId}:`, err),
      );
    });
  }

  // ─── Send to a single subscription ───────────────────

  private async sendToSubscription(
    subscription: {
      id: string;
      endpoint: string;
      p256dhKey: string;
      authKey: string;
    },
    payload: PushPayload,
  ): Promise<void> {
    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dhKey,
        auth: subscription.authKey,
      },
    };

    try {
      await webpush.sendNotification(
        pushSubscription,
        JSON.stringify(payload),
        {
          TTL: 86400, // 24 hours
          urgency: 'normal',
        },
      );
    } catch (err: any) {
      // 410 Gone or 404 Not Found = subscription expired
      if (err.statusCode === 410 || err.statusCode === 404) {
        this.logger.log(`Deactivating expired subscription ${subscription.id}`);
        await this.prisma.pushSubscription
          .update({
            where: { id: subscription.id },
            data: { isActive: false },
          })
          .catch(() => {});
        return;
      }
      throw err;
    }
  }

  // ─── Get user subscriptions ───────────────────────────

  getUserSubscriptions(userId: string) {
    return this.prisma.pushSubscription.findMany({
      where: { userId, isActive: true },
      select: {
        id: true,
        endpoint: true,
        deviceType: true,
        userAgent: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
