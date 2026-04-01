import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { QueryMessagesDto } from './dto/query-messages.dto';
import { ReactMessageDto } from './dto/react-message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RoomMembersService } from '../room/room-members.service';
import { MemberRole } from '@prisma/client';
import type { User } from '@prisma/client';

@ApiTags('messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class MessagesController {
  constructor(
    private messagesService: MessagesService,
    private roomMembersService: RoomMembersService,
  ) {}

  // ─── Room message history ─────────────────────────────

  @Get('rooms/:roomId/messages')
  @ApiParam({ name: 'roomId', type: String })
  @ApiOperation({ summary: 'Get message history with cursor pagination' })
  @ApiResponse({ status: 200, description: 'Paginated message list' })
  getHistory(
    @CurrentUser() user: User,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query() query: QueryMessagesDto,
  ) {
    return this.messagesService.getHistory(roomId, user.id, query);
  }

  // ─── Send message (REST fallback — primary path is WS)

  @Post('rooms/:roomId/messages')
  @ApiParam({ name: 'roomId', type: String })
  @ApiOperation({ summary: 'Send a message via REST (WS preferred)' })
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: User,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: CreateMessageDto,
  ) {
    return this.messagesService.create(user.id, { ...dto, roomId });
  }

  // ─── Thread replies ───────────────────────────────────

  @Get('messages/:messageId/thread')
  @ApiParam({ name: 'messageId', type: String })
  @ApiOperation({ summary: 'Get thread replies for a message' })
  getThread(
    @CurrentUser() user: User,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Query() query: QueryMessagesDto,
  ) {
    return this.messagesService.getThread(messageId, user.id, query);
  }

  // ─── Get single message ───────────────────────────────

  @Get('messages/:messageId')
  @ApiParam({ name: 'messageId', type: String })
  @ApiOperation({ summary: 'Get a single message by ID' })
  findOne(
    @CurrentUser() user: User,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.messagesService.findById(messageId, user.id);
  }

  // ─── Edit message ─────────────────────────────────────

  @Patch('messages/:messageId')
  @ApiParam({ name: 'messageId', type: String })
  @ApiOperation({ summary: 'Edit a message (own messages only)' })
  update(
    @CurrentUser() user: User,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: UpdateMessageDto,
  ) {
    return this.messagesService.update(messageId, user.id, dto);
  }

  // ─── Delete message ───────────────────────────────────

  @Delete('messages/:messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'messageId', type: String })
  @ApiOperation({ summary: 'Soft-delete a message' })
  async remove(
    @CurrentUser() user: User,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    // Check if user is admin to allow deleting others' messages
    const message = await this.messagesService.findById(messageId, user.id);
    let isAdmin = false;

    if (message.senderId !== user.id) {
      const member = await this.roomMembersService.findMembership(
        message.roomId,
        user.id,
      );
      if (!member || member.role === MemberRole.member) {
        throw new ForbiddenException('You can only delete your own messages');
      }
      isAdmin = true;
    }

    return this.messagesService.softDelete(messageId, user.id, isAdmin);
  }

  // ─── Edit history ─────────────────────────────────────

  @Get('messages/:messageId/edits')
  @ApiParam({ name: 'messageId', type: String })
  @ApiOperation({ summary: 'Get edit history for a message' })
  getEdits(
    @CurrentUser() user: User,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.messagesService.getEditHistory(messageId, user.id);
  }

  // ─── Reactions ────────────────────────────────────────

  @Post('messages/:messageId/reactions')
  @ApiParam({ name: 'messageId', type: String })
  @ApiOperation({ summary: 'Toggle emoji reaction on a message' })
  toggleReaction(
    @CurrentUser() user: User,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: ReactMessageDto,
  ) {
    return this.messagesService.toggleReaction(messageId, user.id, dto.emoji);
  }

  // ─── Read receipts ────────────────────────────────────

  @Post('messages/:messageId/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'messageId', type: String })
  @ApiOperation({ summary: 'Mark a message as read' })
  markRead(
    @CurrentUser() user: User,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body('roomId', ParseUUIDPipe) roomId: string,
  ) {
    return this.messagesService.markAsRead(messageId, roomId, user.id);
  }

  @Post('rooms/:roomId/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'roomId', type: String })
  @ApiOperation({ summary: 'Mark all messages in a room as read' })
  markRoomRead(
    @CurrentUser() user: User,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    return this.messagesService.markRoomAsRead(roomId, user.id);
  }

  @Get('messages/:messageId/reads')
  @ApiParam({ name: 'messageId', type: String })
  @ApiOperation({ summary: 'Get read receipts for a message' })
  getReadReceipts(
    @CurrentUser() user: User,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.messagesService.getReadReceipts(messageId, user.id);
  }

  @Get('rooms/:roomId/unread')
  @ApiParam({ name: 'roomId', type: String })
  @ApiOperation({ summary: 'Get unread message count for a room' })
  getUnreadCount(
    @CurrentUser() user: User,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    return this.messagesService.getUnreadCount(roomId, user.id);
  }

  @Get('unread/total')
  @ApiOperation({ summary: 'Get total unread count across all rooms' })
  getTotalUnread(@CurrentUser() user: User) {
    return this.messagesService.getTotalUnread(user.id);
  }

  // ─── Pinned messages ──────────────────────────────────

  @Get('rooms/:roomId/pins')
  @ApiParam({ name: 'roomId', type: String })
  @ApiOperation({ summary: 'Get pinned messages in a room' })
  getPins(
    @CurrentUser() user: User,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    return this.messagesService.getPinnedMessages(roomId, user.id);
  }

  @Post('rooms/:roomId/pins')
  @ApiParam({ name: 'roomId', type: String })
  @ApiOperation({ summary: 'Pin a message (admin/owner only)' })
  pin(
    @CurrentUser() user: User,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.messagesService.pinMessage(roomId, messageId, user.id);
  }

  @Delete('rooms/:roomId/pins/:messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'roomId', type: String })
  @ApiParam({ name: 'messageId', type: String })
  @ApiOperation({ summary: 'Unpin a message (admin/owner only)' })
  unpin(
    @CurrentUser() user: User,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.messagesService.unpinMessage(roomId, messageId, user.id);
  }
}
