import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class MessagesService {
  constructor(private prisma: PrismaService) {}

  create(senderId: string, dto: any): Promise<any> {
    // Full implementation in Phase 5
    return this.prisma.message.create({
      data: {
        roomId: dto.roomId,
        senderId,
        content: dto.content,
        type: dto.type ?? 'text',
        parentId: dto.parentId ?? null,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  async markAsRead(
    messageId: string,
    roomId: string,
    userId: string,
  ): Promise<void> {
    await this.prisma.messageRead.upsert({
      where: { messageId_userId: { messageId, userId } },
      update: { readAt: new Date() },
      create: { messageId, userId },
    });

    await this.prisma.roomMember.update({
      where: { roomId_userId: { roomId, userId } },
      data: { lastReadAt: new Date(), unreadCount: 0 },
    });
  }

  async toggleReaction(
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<any> {
    const existing = await this.prisma.messageReaction.findUnique({
      where: { messageId_userId_emoji: { messageId, userId, emoji } },
    });

    if (existing) {
      await this.prisma.messageReaction.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.messageReaction.create({
        data: { messageId, userId, emoji },
      });
    }

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { roomId: true },
    });

    const reactions = await this.prisma.messageReaction.findMany({
      where: { messageId },
    });

    return { roomId: message?.roomId, reactions };
  }
}
