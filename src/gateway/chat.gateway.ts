import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { UseGuards, Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { Server } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as wsJwtMiddleware from './ws-jwt.middleware';
import { WsJwtGuard } from './ws-jwt.guard';
import { PresenceService } from './presence.service';
import { UsersService } from '../users/users.service';
import { RedisService } from '../redis/redis.service';
import {
  JoinRoomDto,
  LeaveRoomDto,
  SendMessageDto,
  TypingDto,
  ReadReceiptDto,
  UpdateStatusDto,
  ReactToMessageDto,
} from './dto/socket-events.dto';
import { UserStatus } from '@prisma/client';
import { RoomMembersService } from 'src/room/room-members.service';
import { MessagesService } from 'src/messages/messages.service';
import type { AuthenticatedSocket } from './ws-jwt.middleware';

// ─── Socket event names (single source of truth) ─────

export const WS_EVENTS = {
  // Client → Server
  JOIN_ROOM: 'room:join',
  LEAVE_ROOM: 'room:leave',
  SEND_MESSAGE: 'message:send',
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
  MESSAGE_READ: 'message:read',
  REACT: 'message:react',
  UPDATE_STATUS: 'status:update',
  HEARTBEAT: 'heartbeat',

  // Server → Client
  MESSAGE_NEW: 'message:new',
  MESSAGE_UPDATED: 'message:updated',
  MESSAGE_DELETED: 'message:deleted',
  REACTION_UPDATED: 'message:reaction',
  USER_TYPING: 'typing:user',
  USER_STOPPED_TYPING: 'typing:stop',
  READ_RECEIPT: 'message:read_receipt',
  PRESENCE_UPDATED: 'presence:updated',
  ROOM_UPDATED: 'room:updated',
  ERROR: 'error',
} as const;

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
  },
  namespace: '/',
  transports: ['websocket', 'polling'],
})
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  // Typing debounce: roomId:userId → timeout handle
  private typingTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private presenceService: PresenceService,
    private roomMembersService: RoomMembersService,
    private messagesService: MessagesService,
    private usersService: UsersService,
    private redisService: RedisService,
    private wsJwtMiddleware: wsJwtMiddleware.WsJwtMiddleware,
  ) {}

  // ─── Init ─────────────────────────────────────────────

  afterInit(server: Server) {
    // Apply JWT middleware to all connections
    server.use(this.wsJwtMiddleware.middleware() as any);
    this.logger.log('WebSocket gateway initialised');
  }

  // ─── Connection ───────────────────────────────────────

  async handleConnection(client: wsJwtMiddleware.AuthenticatedSocket) {
    try {
      if (!client.userId) {
        this.logger.warn(`Unauthenticated connection attempt: ${client.id}`);
        client.disconnect();
        return;
      }

      this.logger.log(
        `Client connected: ${client.id} (user: ${client.username})`,
      );

      // Track presence
      await this.presenceService.userConnected(client.userId, client.id);

      // Auto-join all the user's active rooms
      const memberships = await this.getRoomMemberships(client.userId);
      for (const roomId of memberships) {
        await client.join(roomId);
      }

      // Notify all rooms this user is in that they came online
      await this.broadcastPresenceUpdate(client.userId, 'online');

      // Send current presence of all room members back to this client
      await this.sendRoomPresences(client, memberships);

      // Acknowledge connection
      client.emit('connected', {
        socketId: client.id,
        userId: client.userId,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error(`Connection error for ${client.id}:`, err);
      client.disconnect();
    }
  }

  // ─── Disconnection ────────────────────────────────────

  async handleDisconnect(client: wsJwtMiddleware.AuthenticatedSocket) {
    if (!client.userId) return;

    this.logger.log(
      `Client disconnected: ${client.id} (user: ${client.username})`,
    );

    // Clear any pending typing timers for this socket
    for (const [key, timer] of this.typingTimers) {
      if (key.includes(client.userId)) {
        clearTimeout(timer);
        this.typingTimers.delete(key);
      }
    }

    const { wentOffline } = await this.presenceService.userDisconnected(
      client.userId,
      client.id,
    );

    if (wentOffline) {
      await this.broadcastPresenceUpdate(client.userId, 'offline');
    }
  }

  // ─── Join room ────────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(WS_EVENTS.JOIN_ROOM)
  async handleJoinRoom(
    @ConnectedSocket() client: wsJwtMiddleware.AuthenticatedSocket,
    @MessageBody() dto: JoinRoomDto,
  ) {
    try {
      const membership = await this.roomMembersService.findMembership(
        dto.roomId,
        client.userId,
      );

      if (!membership || membership.leftAt) {
        throw new WsException('You are not a member of this room');
      }

      await client.join(dto.roomId);

      this.logger.debug(`${client.username} joined room ${dto.roomId}`);

      return {
        event: WS_EVENTS.JOIN_ROOM,
        data: { roomId: dto.roomId, success: true },
      };
    } catch (err) {
      this.emitError(client, err.message);
    }
  }

  // ─── Leave room ───────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(WS_EVENTS.LEAVE_ROOM)
  async handleLeaveRoom(
    @ConnectedSocket() client: wsJwtMiddleware.AuthenticatedSocket,
    @MessageBody() dto: LeaveRoomDto,
  ) {
    await client.leave(dto.roomId);
    return { event: WS_EVENTS.LEAVE_ROOM, data: { roomId: dto.roomId } };
  }

  // ─── Send message ─────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(WS_EVENTS.SEND_MESSAGE)
  async handleSendMessage(
    @ConnectedSocket() client: wsJwtMiddleware.AuthenticatedSocket,
    @MessageBody() dto: SendMessageDto,
  ) {
    try {
      const message = await this.messagesService.create(client.userId, {
        roomId: dto.roomId,
        content: dto.content,
        type: dto.type,
        parentId: dto.parentId,
        fileId: dto.fileId,
      });

      // Broadcast to ALL room members (including sender for confirmation)
      this.server.to(dto.roomId).emit(WS_EVENTS.MESSAGE_NEW, {
        ...message,
        clientMessageId: dto.clientMessageId,
      });
      // Clear typing indicator
      const typingKey = `${dto.roomId}:${client.userId}`;
      if (this.typingTimers.has(typingKey)) {
        clearTimeout(this.typingTimers.get(typingKey));
        this.typingTimers.delete(typingKey);
      }
      client.to(dto.roomId).emit(WS_EVENTS.USER_STOPPED_TYPING, {
        roomId: dto.roomId,
        userId: client.userId,
      });
      return {
        event: WS_EVENTS.SEND_MESSAGE,
        data: { success: true, messageId: message.id },
      };
    } catch (err) {
      this.emitError(client, err.message);
    }
  }

  // ─── Typing: start ────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(WS_EVENTS.TYPING_START)
  handleTypingStart(
    @ConnectedSocket() client: wsJwtMiddleware.AuthenticatedSocket,
    @MessageBody() dto: TypingDto,
  ) {
    const typingKey = `${dto.roomId}:${client.userId}`;

    // Clear existing timer for this user in this room
    if (this.typingTimers.has(typingKey)) {
      clearTimeout(this.typingTimers.get(typingKey));
    }

    // Broadcast to room (excluding sender)
    client.to(dto.roomId).emit(WS_EVENTS.USER_TYPING, {
      roomId: dto.roomId,
      userId: client.userId,
      username: client.username,
    });

    // Auto-stop typing after 5 seconds of inactivity
    const timer = setTimeout(() => {
      this.typingTimers.delete(typingKey);
      client.to(dto.roomId).emit(WS_EVENTS.USER_STOPPED_TYPING, {
        roomId: dto.roomId,
        userId: client.userId,
      });
    }, 5000);

    this.typingTimers.set(typingKey, timer);
  }

  // ─── Typing: stop ─────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(WS_EVENTS.TYPING_STOP)
  handleTypingStop(
    @ConnectedSocket() client: wsJwtMiddleware.AuthenticatedSocket,
    @MessageBody() dto: TypingDto,
  ) {
    const typingKey = `${dto.roomId}:${client.userId}`;

    if (this.typingTimers.has(typingKey)) {
      clearTimeout(this.typingTimers.get(typingKey));
      this.typingTimers.delete(typingKey);
    }

    client.to(dto.roomId).emit(WS_EVENTS.USER_STOPPED_TYPING, {
      roomId: dto.roomId,
      userId: client.userId,
    });
  }

  // ─── Read receipt ─────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(WS_EVENTS.MESSAGE_READ)
  async handleMessageRead(
    @ConnectedSocket() client: wsJwtMiddleware.AuthenticatedSocket,
    @MessageBody() dto: ReadReceiptDto,
  ) {
    try {
      await this.messagesService.markAsRead(
        dto.messageId,
        dto.roomId,
        client.userId,
      );

      // Broadcast read receipt to all room members
      this.server.to(dto.roomId).emit(WS_EVENTS.READ_RECEIPT, {
        roomId: dto.roomId,
        messageId: dto.messageId,
        userId: client.userId,
        readAt: new Date().toISOString(),
      });

      return { event: WS_EVENTS.MESSAGE_READ, data: { success: true } };
    } catch (err) {
      this.emitError(client, err.message);
    }
  }

  // ─── React to message ─────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(WS_EVENTS.REACT)
  async handleReaction(
    @ConnectedSocket() client: wsJwtMiddleware.AuthenticatedSocket,
    @MessageBody() dto: ReactToMessageDto,
  ) {
    try {
      const result = await this.messagesService.toggleReaction(
        dto.messageId,
        client.userId,
        dto.emoji,
      );

      // Find the room this message belongs to
      const roomId = result.roomId;

      this.server.to(roomId).emit(WS_EVENTS.REACTION_UPDATED, {
        messageId: dto.messageId,
        roomId,
        reactions: result.reactions,
        actorId: client.userId,
      });

      return { event: WS_EVENTS.REACT, data: { success: true } };
    } catch (err) {
      this.emitError(client, err.message);
    }
  }

  // ─── Status update ────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(WS_EVENTS.UPDATE_STATUS)
  async handleStatusUpdate(
    @ConnectedSocket() client: wsJwtMiddleware.AuthenticatedSocket,
    @MessageBody() dto: UpdateStatusDto,
  ) {
    await this.presenceService.setStatus(
      client.userId,
      dto.status as UserStatus,
    );

    await this.broadcastPresenceUpdate(client.userId, dto.status);

    return { event: WS_EVENTS.UPDATE_STATUS, data: { status: dto.status } };
  }

  // ─── Heartbeat ────────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(WS_EVENTS.HEARTBEAT)
  async handleHeartbeat(
    @ConnectedSocket() client: wsJwtMiddleware.AuthenticatedSocket,
  ) {
    await this.presenceService.heartbeat(client.userId);
    return { event: WS_EVENTS.HEARTBEAT, data: { ts: Date.now() } };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('message:edit')
  async handleEditMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { messageId: string; content: string },
  ) {
    try {
      const updated = await this.messagesService.update(
        body.messageId,
        client.userId,
        { content: body.content },
      );
      this.server.to(updated.roomId).emit(WS_EVENTS.MESSAGE_UPDATED, updated);
      return { event: 'message:edit', data: { success: true } };
    } catch (err) {
      this.emitError(client, err.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('message:delete')
  async handleDeleteMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { messageId: string },
  ) {
    try {
      const deleted = await this.messagesService.softDelete(
        body.messageId,
        client.userId,
      );
      this.server.to(deleted.roomId).emit(WS_EVENTS.MESSAGE_DELETED, {
        messageId: body.messageId,
        roomId: deleted.roomId,
        deletedAt: new Date().toISOString(),
      });
      return { event: 'message:delete', data: { success: true } };
    } catch (err) {
      this.emitError(client, err.message);
    }
  }

  // ─── Broadcast helpers ────────────────────────────────

  // Emit a message update to a room (called by MessagesService)
  emitMessageUpdated(roomId: string, message: any) {
    this.server.to(roomId).emit(WS_EVENTS.MESSAGE_UPDATED, message);
  }

  emitMessageDeleted(roomId: string, messageId: string) {
    this.server.to(roomId).emit(WS_EVENTS.MESSAGE_DELETED, {
      roomId,
      messageId,
      deletedAt: new Date().toISOString(),
    });
  }

  emitRoomUpdated(roomId: string, room: any) {
    this.server.to(roomId).emit(WS_EVENTS.ROOM_UPDATED, room);
  }

  // ─── Private helpers ──────────────────────────────────

  private emitError(
    client: wsJwtMiddleware.AuthenticatedSocket,
    message: string,
  ) {
    client.emit(WS_EVENTS.ERROR, { message });
  }

  private async broadcastPresenceUpdate(
    userId: string,
    status: string,
  ): Promise<void> {
    const memberships = await this.getRoomMemberships(userId);

    const update = {
      userId,
      status,
      lastSeenAt: new Date().toISOString(),
    };

    // Broadcast to each room this user is in
    for (const roomId of memberships) {
      this.server.to(roomId).emit(WS_EVENTS.PRESENCE_UPDATED, update);
    }
  }

  private async getRoomMemberships(userId: string): Promise<string[]> {
    return this.roomMembersService.getUserRoomIds(userId);
  }

  private async sendRoomPresences(
    client: wsJwtMiddleware.AuthenticatedSocket,
    roomIds: string[],
  ): Promise<void> {
    // Collect all unique member IDs across all rooms
    const allMemberIds = new Set<string>();

    for (const roomId of roomIds) {
      const ids = await this.roomMembersService.getRoomMemberIds(roomId);
      ids.forEach((id) => allMemberIds.add(id));
    }

    const presences = await this.presenceService.getManyPresence([
      ...allMemberIds,
    ]);

    client.emit('presence:bulk', { presences });
  }
}
