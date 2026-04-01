import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { QueryMessagesDto } from './dto/query-messages.dto';
import { MessageType, Prisma } from '@prisma/client';
import { RoomMembersService } from 'src/room/room-members.service';
import { RoomsService } from 'src/room/rooms.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  MessageCreatedEvent,
  MessageDeletedEvent,
  MessageUpdatedEvent,
  SEARCH_EVENTS,
} from 'src/search/search.events';

// ─── Shared include shape ─────────────────────────────

const MESSAGE_INCLUDE = {
  sender: {
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
    },
  },
  reactions: {
    include: {
      user: {
        select: { id: true, username: true, displayName: true },
      },
    },
  },
  files: {
    select: {
      id: true,
      originalName: true,
      contentType: true,
      sizeBytes: true,
      width: true,
      height: true,
      thumbnailKey: true,
      s3Key: true,
    },
  },
  _count: {
    select: { replies: true, reads: true },
  },
} satisfies Prisma.MessageInclude;

// Grouped reactions shape: { '👍': [{ userId, username }] }
type GroupedReactions = Record<
  string,
  { userId: string; username: string; displayName: string | null }[]
>;

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private prisma: PrismaService,
    private roomMembersService: RoomMembersService,
    private roomsService: RoomsService,
    private notificationsService: NotificationsService,
    private eventEmitter: EventEmitter2,
  ) {}

  // ─── Group reactions by emoji ─────────────────────────

  private groupReactions(
    reactions: { emoji: string; user: any }[],
  ): GroupedReactions {
    return reactions.reduce((acc, r) => {
      if (!acc[r.emoji]) acc[r.emoji] = [];
      acc[r.emoji].push(r.user);
      return acc;
    }, {} as GroupedReactions);
  }

  private formatMessage(message: any) {
    return {
      ...message,
      reactions: this.groupReactions(message.reactions ?? []),
    };
  }

  // ─── Create message ───────────────────────────────────

  async create(senderId: string, dto: CreateMessageDto) {
    // Verify membership
    const membership = await this.roomMembersService.findMembership(
      dto.roomId,
      senderId,
    );
    if (!membership || membership.leftAt) {
      throw new ForbiddenException('Not a member of this room');
    }
    if (membership.isMuted) {
      const stillMuted =
        !membership.mutedUntil || membership.mutedUntil > new Date();
      if (stillMuted)
        throw new ForbiddenException('You are muted in this room');
    }

    // Validate thread parent
    if (dto.parentId) {
      const parent = await this.prisma.message.findUnique({
        where: { id: dto.parentId },
        select: { roomId: true, parentId: true, isDeleted: true },
      });
      if (!parent) throw new NotFoundException('Parent message not found');
      if (parent.roomId !== dto.roomId) {
        throw new BadRequestException('Parent message is in a different room');
      }
      if (parent.parentId) {
        throw new BadRequestException(
          'Cannot reply to a reply — only one level of threading supported',
        );
      }
      if (parent.isDeleted) {
        throw new BadRequestException('Cannot reply to a deleted message');
      }
    }

    // Validate file ownership
    if (dto.fileId) {
      const file = await this.prisma.file.findUnique({
        where: { id: dto.fileId },
        select: { uploaderId: true },
      });
      if (!file) throw new NotFoundException('File not found');
      if (file.uploaderId !== senderId) {
        throw new ForbiddenException('File does not belong to you');
      }
    }

    // Create message in a transaction
    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          roomId: dto.roomId,
          senderId,
          content: dto.content,
          type: dto.type ?? MessageType.text,
          parentId: dto.parentId ?? null,
          ...(dto.fileId && {
            files: { connect: { id: dto.fileId } },
          }),
        },
        include: MESSAGE_INCLUDE,
      });

      // Update room.lastMessageAt
      await tx.room.update({
        where: { id: dto.roomId },
        data: { lastMessageAt: new Date() },
      });

      // Increment unread counts for all members except sender
      await tx.roomMember.updateMany({
        where: {
          roomId: dto.roomId,
          userId: { not: senderId },
          leftAt: null,
        },
        data: { unreadCount: { increment: 1 } },
      });

      // Increment parent replyCount for thread replies
      if (created.parentId) {
        await tx.message.update({
          where: { id: created.parentId },
          data: { replyCount: { increment: 1 } },
        });
      }

      return created;
    });

    this.eventEmitter.emit(
      SEARCH_EVENTS.MESSAGE_CREATED,
      new MessageCreatedEvent({
        id: message.id,
        roomId: message.roomId,
        senderId: message.senderId,
        senderUsername: message.sender?.username ?? '',
        senderDisplayName: message.sender?.displayName ?? null,
        content: message.content,
        type: message.type,
        parentId: message.parentId,
        isDeleted: message.isDeleted,
        isEdited: message.isEdited,
        replyCount: message.replyCount,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
      }),
    );

    const formatted = this.formatMessage(message);

    // ── Trigger notifications async (don't await — non-blocking) ──
    this.triggerNotifications(formatted, senderId, dto.roomId).catch((err) =>
      this.logger.error('Notification trigger failed:', err),
    );
    return formatted;
  }

  // ─── Get room message history (cursor pagination) ─────

  async getHistory(
    roomId: string,
    requestingUserId: string,
    dto: QueryMessagesDto,
  ) {
    // Verify membership
    await this.roomMembersService.requireMembership(roomId, requestingUserId);

    const limit = dto.limit ?? 30;

    // ── Full-text search path ──────────────────────────
    if (dto.search?.trim()) {
      return this.searchMessages(roomId, dto.search.trim(), limit);
    }

    // ── Normal history path ───────────────────────────
    const where: Prisma.MessageWhereInput = {
      roomId,
      isDeleted: false,
      parentId: dto.parentId ?? null, // null = top-level, uuid = thread
      ...(dto.before && { createdAt: { lt: new Date(dto.before) } }),
      ...(dto.after && { createdAt: { gt: new Date(dto.after) } }),
    };

    // Cursor-based pagination
    const queryOptions: Prisma.MessageFindManyArgs = {
      where,
      take: limit + 1, // fetch one extra to determine hasMore
      orderBy: { createdAt: 'desc' },
      include: MESSAGE_INCLUDE,
      ...(dto.cursor && {
        cursor: { id: dto.cursor },
        skip: 1, // skip the cursor message itself
      }),
    };

    const messages = await this.prisma.message.findMany(queryOptions);

    const hasMore = messages.length > limit;
    const data = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return {
      data: data.map((m) => this.formatMessage(m)),
      nextCursor,
      hasMore,
    };
  }

  private async triggerNotifications(
    message: any,
    senderId: string,
    roomId: string,
  ): Promise<void> {
    // Get room and all member IDs
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { name: true, type: true },
    });

    const sender = await this.prisma.user.findUnique({
      where: { id: senderId },
      select: { username: true, displayName: true },
    });

    const memberIds = await this.roomMembersService.getRoomMemberIds(roomId);

    const senderName = sender?.displayName || sender?.username || 'Someone';

    // Standard new message notifications
    await this.notificationsService.notifyNewMessage({
      message,
      roomId,
      senderId,
      senderName,
      roomName: room?.name ?? null,
      recipientIds: memberIds,
    });

    // @mention detection
    if (message.content) {
      const mentionedUsernames = this.notificationsService.parseMentions(
        message.content,
      );

      if (mentionedUsernames.length > 0) {
        const mentionedUsers = await this.prisma.user.findMany({
          where: {
            username: { in: mentionedUsernames },
            id: { in: memberIds }, // only notify room members
          },
          select: { id: true },
        });

        if (mentionedUsers.length > 0) {
          await this.notificationsService.notifyMention({
            message,
            roomId,
            senderId,
            senderName,
            mentionedUserIds: mentionedUsers.map((u) => u.id),
          });
        }
      }
    }
  }
  // ─── Full-text search ─────────────────────────────────

  private async searchMessages(roomId: string, query: string, limit: number) {
    // Try Postgres tsvector first
    const results = await this.prisma.$queryRaw<any[]>`
      SELECT
        m.id,
        m.room_id     AS "roomId",
        m.sender_id   AS "senderId",
        m.parent_id   AS "parentId",
        m.content,
        m.type,
        m.is_edited   AS "isEdited",
        m.is_deleted  AS "isDeleted",
        m.reply_count AS "replyCount",
        m.created_at  AS "createdAt",
        m.updated_at  AS "updatedAt",
        ts_rank(m.content_search, plainto_tsquery('english', ${query})) AS rank,
        ts_headline(
          'english',
          m.content,
          plainto_tsquery('english', ${query}),
          'MaxWords=20, MinWords=5, StartSel=<mark>, StopSel=</mark>'
        ) AS headline
      FROM messages m
      WHERE
        m.room_id    = ${roomId}::uuid
        AND m.is_deleted = false
        AND m.content_search @@ plainto_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${limit}
    `;

    return { data: results, nextCursor: null, hasMore: false };
  }

  // ─── Get single message ───────────────────────────────

  async findById(messageId: string, requestingUserId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: MESSAGE_INCLUDE,
    });

    if (!message || message.isDeleted) {
      throw new NotFoundException('Message not found');
    }

    await this.roomMembersService.requireMembership(
      message.roomId,
      requestingUserId,
    );

    return this.formatMessage(message);
  }

  // ─── Edit message ─────────────────────────────────────

  async update(messageId: string, editorId: string, dto: UpdateMessageDto) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        senderId: true,
        roomId: true,
        content: true,
        isDeleted: true,
        type: true,
      },
    });

    if (!message || message.isDeleted) {
      throw new NotFoundException('Message not found');
    }
    if (message.senderId !== editorId) {
      throw new ForbiddenException('You can only edit your own messages');
    }
    if (message.type !== MessageType.text) {
      throw new BadRequestException('Only text messages can be edited');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.message.update({
        where: { id: messageId },
        data: {
          content: dto.content,
          isEdited: true,
        },
        include: MESSAGE_INCLUDE,
      }),
      this.prisma.messageEdit.create({
        data: {
          messageId,
          editorId,
          previousContent: message.content,
        },
      }),
    ]);

    this.eventEmitter.emit(
      SEARCH_EVENTS.MESSAGE_UPDATED,
      new MessageUpdatedEvent(messageId, {
        content: dto.content,
        isEdited: true,
      }),
    );
    return this.formatMessage(updated);
  }

  // ─── Get edit history ─────────────────────────────────

  async getEditHistory(messageId: string, requestingUserId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { roomId: true, isDeleted: true },
    });

    if (!message || message.isDeleted) {
      throw new NotFoundException('Message not found');
    }

    await this.roomMembersService.requireMembership(
      message.roomId,
      requestingUserId,
    );

    return this.prisma.messageEdit.findMany({
      where: { messageId },
      include: {
        editor: {
          select: { id: true, username: true, displayName: true },
        },
      },
      orderBy: { editedAt: 'desc' },
    });
  }

  // ─── Soft delete ──────────────────────────────────────

  async softDelete(messageId: string, deleterId: string, isAdmin = false) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        senderId: true,
        roomId: true,
        parentId: true,
        isDeleted: true,
      },
    });

    if (!message || message.isDeleted) {
      throw new NotFoundException('Message not found');
    }

    // Own message OR room admin/owner can delete
    if (message.senderId !== deleterId && !isAdmin) {
      throw new ForbiddenException('You can only delete your own messages');
    }

    const deleted = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        content: null, // wipe content on delete for privacy
      },
      include: MESSAGE_INCLUDE,
    });

    // Decrement parent replyCount for thread replies
    if (message.parentId) {
      await this.prisma.message
        .update({
          where: { id: message.parentId },
          data: { replyCount: { decrement: 1 } },
        })
        .catch((e) => this.logger.error('Failed to decrement replyCount', e));
    }

    this.eventEmitter.emit(
      SEARCH_EVENTS.MESSAGE_DELETED,
      new MessageDeletedEvent(messageId),
    );

    return {
      ...this.formatMessage(deleted),
      roomId: message.roomId,
    };
  }

  // ─── Reactions ────────────────────────────────────────

  async toggleReaction(messageId: string, userId: string, emoji: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { roomId: true, isDeleted: true },
    });

    if (!message || message.isDeleted) {
      throw new NotFoundException('Message not found');
    }

    await this.roomMembersService.requireMembership(message.roomId, userId);

    // Toggle: if exists remove, if not exists add
    const existing = await this.prisma.messageReaction.findUnique({
      where: {
        messageId_userId_emoji: { messageId, userId, emoji },
      },
    });

    if (existing) {
      await this.prisma.messageReaction.delete({
        where: { id: existing.id },
      });
    } else {
      await this.prisma.messageReaction.create({
        data: { messageId, userId, emoji },
      });
    }

    // Return full updated reactions for the message
    const reactions = await this.prisma.messageReaction.findMany({
      where: { messageId },
      include: {
        user: {
          select: { id: true, username: true, displayName: true },
        },
      },
    });

    return {
      messageId,
      roomId: message.roomId,
      reactions: this.groupReactions(reactions),
      added: !existing,
    };
  }

  // ─── Read receipts ────────────────────────────────────

  async markAsRead(
    messageId: string,
    roomId: string,
    userId: string,
  ): Promise<void> {
    // Upsert read receipt
    await this.prisma.messageRead.upsert({
      where: { messageId_userId: { messageId, userId } },
      update: { readAt: new Date() },
      create: { messageId, userId },
    });

    // Reset unread counter
    await this.prisma.roomMember.update({
      where: { roomId_userId: { roomId, userId } },
      data: { lastReadAt: new Date(), unreadCount: 0 },
    });
  }

  async markRoomAsRead(roomId: string, userId: string): Promise<void> {
    // Mark all unread messages in a room as read in one query
    const unreadMessages = await this.prisma.message.findMany({
      where: {
        roomId,
        isDeleted: false,
        reads: { none: { userId } },
      },
      select: { id: true },
      take: 500,
    });

    if (unreadMessages.length > 0) {
      await this.prisma.messageRead.createMany({
        data: unreadMessages.map((m) => ({ messageId: m.id, userId })),
        skipDuplicates: true,
      });
    }

    await this.prisma.roomMember.update({
      where: { roomId_userId: { roomId, userId } },
      data: { lastReadAt: new Date(), unreadCount: 0 },
    });
  }

  async getReadReceipts(messageId: string, requestingUserId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { roomId: true },
    });
    if (!message) throw new NotFoundException('Message not found');

    await this.roomMembersService.requireMembership(
      message.roomId,
      requestingUserId,
    );

    return this.prisma.messageRead.findMany({
      where: { messageId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { readAt: 'asc' },
    });
  }

  async getUnreadCount(roomId: string, userId: string): Promise<number> {
    const member = await this.roomMembersService.findMembership(roomId, userId);
    return member?.unreadCount ?? 0;
  }

  // ─── Pin / unpin ──────────────────────────────────────

  async pinMessage(roomId: string, messageId: string, pinnedBy: string) {
    await this.roomMembersService.requireRole(roomId, pinnedBy, 'admin' as any);

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { roomId: true, isDeleted: true },
    });

    if (!message || message.isDeleted) {
      throw new NotFoundException('Message not found');
    }
    if (message.roomId !== roomId) {
      throw new BadRequestException('Message does not belong to this room');
    }

    try {
      return await this.prisma.messagePin.create({
        data: { roomId, messageId, pinnedBy },
        include: {
          message: { include: MESSAGE_INCLUDE },
          pinner: {
            select: { id: true, username: true, displayName: true },
          },
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException('Message is already pinned');
      }
      throw e;
    }
  }

  async unpinMessage(roomId: string, messageId: string, actorId: string) {
    await this.roomMembersService.requireRole(roomId, actorId, 'admin' as any);

    const pin = await this.prisma.messagePin.findUnique({
      where: { messageId },
    });

    if (!pin || pin.roomId !== roomId) {
      throw new NotFoundException('Pin not found');
    }

    await this.prisma.messagePin.delete({ where: { id: pin.id } });
  }

  async getPinnedMessages(roomId: string, requestingUserId: string) {
    await this.roomMembersService.requireMembership(roomId, requestingUserId);

    return this.prisma.messagePin.findMany({
      where: { roomId },
      include: {
        message: { include: MESSAGE_INCLUDE },
        pinner: {
          select: { id: true, username: true, displayName: true },
        },
      },
      orderBy: { pinnedAt: 'desc' },
    });
  }

  // ─── Thread: get replies ──────────────────────────────

  async getThread(
    messageId: string,
    requestingUserId: string,
    dto: QueryMessagesDto,
  ) {
    const parent = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { roomId: true, isDeleted: true },
    });

    if (!parent || parent.isDeleted) {
      throw new NotFoundException('Message not found');
    }

    await this.roomMembersService.requireMembership(
      parent.roomId,
      requestingUserId,
    );

    return this.getHistory(parent.roomId, requestingUserId, {
      ...dto,
      parentId: messageId,
    });
  }

  // ─── Total unread across all rooms ───────────────────

  async getTotalUnread(userId: string): Promise<number> {
    const result = await this.prisma.roomMember.aggregate({
      where: { userId, leftAt: null },
      _sum: { unreadCount: true },
    });
    return result._sum.unreadCount ?? 0;
  }
}
