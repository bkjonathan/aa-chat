import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  PushNotificationsService,
  PushPayload,
} from './push-notifications.service';
import { PresenceService } from '../gateway/presence.service';
import { NotificationType } from '@prisma/client';
import { QueryNotificationsDto } from './dto/query-notifications.dto';

export interface CreateNotificationDto {
  recipientId: string;
  actorId?: string;
  type: NotificationType;
  roomId?: string;
  messageId?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private pushService: PushNotificationsService,
    private presenceService: PresenceService,
  ) {}

  // ─── Create in-app notification ───────────────────────

  create(dto: CreateNotificationDto) {
    return this.prisma.notification.create({
      data: {
        recipientId: dto.recipientId,
        actorId: dto.actorId,
        type: dto.type,
        roomId: dto.roomId,
        messageId: dto.messageId,
      },
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
        room: {
          select: { id: true, name: true, type: true },
        },
      },
    });
  }

  // ─── Get notifications ────────────────────────────────

  async getNotifications(userId: string, dto: QueryNotificationsDto) {
    const where = {
      recipientId: userId,
      ...(dto.unreadOnly && { isRead: false }),
    };

    const notifications = await this.prisma.notification.findMany({
      where,
      take: (dto.limit ?? 20) + 1,
      orderBy: { createdAt: 'desc' },
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
        room: {
          select: { id: true, name: true, type: true },
        },
        message: {
          select: { id: true, content: true, type: true },
        },
      },
      ...(dto.cursor && {
        cursor: { id: dto.cursor },
        skip: 1,
      }),
    });

    const limit = dto.limit ?? 20;
    const hasMore = notifications.length > limit;
    const data = hasMore ? notifications.slice(0, limit) : notifications;

    return {
      data,
      nextCursor: hasMore ? data[data.length - 1].id : null,
      hasMore,
    };
  }

  // ─── Badge counts ─────────────────────────────────────

  getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { recipientId: userId, isRead: false },
    });
  }

  async markAsRead(userId: string, notificationIds: string[]): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        id: { in: notificationIds },
        recipientId: userId,
      },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { recipientId: userId, isRead: false },
      data: { isRead: true },
    });
  }

  // ─── Core: notify on new message ─────────────────────

  async notifyNewMessage(params: {
    message: any;
    roomId: string;
    senderId: string;
    senderName: string;
    roomName: string | null;
    recipientIds: string[];
  }): Promise<void> {
    const { message, roomId, senderId, senderName, roomName, recipientIds } =
      params;

    // Filter out the sender
    const targets = recipientIds.filter((id) => id !== senderId);
    if (targets.length === 0) return;

    // Build push payload once
    const pushPayload: PushPayload = {
      title: roomName ? `${senderName} in ${roomName}` : senderName,
      body: this.buildMessagePreview(message),
      tag: `room-${roomId}`,
      data: {
        roomId,
        messageId: message.id,
        type: 'new_message',
        url: `/chat/${roomId}`,
      },
    };

    // Process each recipient
    await Promise.allSettled(
      targets.map((recipientId) =>
        this.processRecipient({
          recipientId,
          senderId,
          message,
          roomId,
          pushPayload,
        }),
      ),
    );
  }

  private async processRecipient(params: {
    recipientId: string;
    senderId: string;
    message: any;
    roomId: string;
    pushPayload: PushPayload;
  }): Promise<void> {
    const { recipientId, senderId, message, roomId, pushPayload } = params;

    try {
      // Create in-app notification
      await this.create({
        recipientId,
        actorId: senderId,
        type: NotificationType.dm,
        roomId,
        messageId: message.id,
      });

      // Send push only if user is offline
      const isOnline = await this.presenceService.isOnline(recipientId);
      if (!isOnline) {
        const { sent, failed } = await this.pushService.sendToUser(
          recipientId,
          pushPayload,
        );

        if (sent > 0) {
          // Record push sent timestamp
          await this.prisma.notification.updateMany({
            where: {
              recipientId,
              messageId: message.id,
              pushSentAt: null,
            },
            data: { pushSentAt: new Date() },
          });

          this.logger.log(
            `Push sent to ${recipientId}: ${sent} devices, ${failed} failed`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`Failed to notify recipient ${recipientId}:`, err);
    }
  }

  // ─── Notify on @mention ───────────────────────────────

  async notifyMention(params: {
    message: any;
    roomId: string;
    senderId: string;
    senderName: string;
    mentionedUserIds: string[];
  }): Promise<void> {
    const { message, roomId, senderId, senderName, mentionedUserIds } = params;

    const payload: PushPayload = {
      title: `${senderName} mentioned you`,
      body: this.buildMessagePreview(message),
      tag: `mention-${message.id}`,
      data: {
        roomId,
        messageId: message.id,
        type: 'mention',
        url: `/chat/${roomId}?message=${message.id}`,
      },
    };

    await Promise.allSettled(
      mentionedUserIds
        .filter((id) => id !== senderId)
        .map(async (recipientId) => {
          await this.create({
            recipientId,
            actorId: senderId,
            type: NotificationType.mention,
            roomId,
            messageId: message.id,
          });

          const isOnline = await this.presenceService.isOnline(recipientId);
          if (!isOnline) {
            await this.pushService.sendToUser(recipientId, payload);
          }
        }),
    );
  }

  // ─── Notify on reaction ───────────────────────────────

  async notifyReaction(params: {
    messageId: string;
    roomId: string;
    reactorId: string;
    reactorName: string;
    messageOwnerId: string;
    emoji: string;
  }): Promise<void> {
    const { messageId, roomId, reactorId, reactorName, messageOwnerId, emoji } =
      params;

    if (reactorId === messageOwnerId) return;

    await this.create({
      recipientId: messageOwnerId,
      actorId: reactorId,
      type: NotificationType.reaction,
      roomId,
      messageId,
    });

    const isOnline = await this.presenceService.isOnline(messageOwnerId);
    if (!isOnline) {
      await this.pushService.sendToUser(messageOwnerId, {
        title: `${reactorName} reacted ${emoji} to your message`,
        body: 'Tap to see the reaction',
        tag: `reaction-${messageId}`,
        data: { roomId, messageId, type: 'reaction' },
      });
    }
  }

  // ─── Message preview helper ───────────────────────────

  private buildMessagePreview(message: any): string {
    if (!message) return 'New message';
    if (message.type === 'image') return '📷 Image';
    if (message.type === 'file') return '📎 File';
    if (message.type === 'audio') return '🎵 Audio';
    if (!message.content) return 'New message';

    const preview = message.content.slice(0, 80);
    return preview.length < message.content.length ? `${preview}…` : preview;
  }

  // ─── Parse @mentions from message content ────────────

  parseMentions(content: string): string[] {
    // Matches @username patterns
    const mentionRegex = /@([a-zA-Z0-9_]+)/g;
    const matches = content.matchAll(mentionRegex);
    return [...matches].map((m) => m[1]);
  }
}
