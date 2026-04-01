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
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { RoomsService } from './rooms.service';
import { RoomMembersService } from './room-members.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { CreateInviteDto } from './dto/create-invite.dto';
import { QueryRoomsDto } from './dto/query-rooms.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { User } from '@prisma/client';

@ApiTags('rooms')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('rooms')
export class RoomsController {
  constructor(
    private roomsService: RoomsService,
    private membersService: RoomMembersService,
  ) {}

  // ─── Get my rooms ────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Get all rooms the current user is in' })
  getMyRooms(@CurrentUser() user: User, @Query() query: QueryRoomsDto) {
    return this.roomsService.getUserRooms(user.id, query);
  }

  // ─── Create room ─────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a new room (DM, group, or channel)' })
  @ApiResponse({ status: 201, description: 'Room created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({
    status: 409,
    description: 'DM already exists (returned as existing room)',
  })
  create(@CurrentUser() user: User, @Body() dto: CreateRoomDto) {
    return this.roomsService.create(user.id, dto);
  }

  // ─── Get room by ID ──────────────────────────────────

  @Get(':id')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Get room by ID' })
  findOne(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.roomsService.findById(id, user.id);
  }

  // ─── Update room ─────────────────────────────────────

  @Patch(':id')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Update room (admin or owner only)' })
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.roomsService.update(id, user.id, dto);
  }

  // ─── Archive / unarchive ─────────────────────────────

  @Patch(':id/archive')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Archive a room (owner only)' })
  archive(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.roomsService.archive(id, user.id);
  }

  @Patch(':id/unarchive')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Unarchive a room (owner only)' })
  unarchive(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.roomsService.unarchive(id, user.id);
  }

  // ─── Members ─────────────────────────────────────────

  @Get(':id/members')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Get room members list' })
  getMembers(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.membersService.getMembers(id);
  }

  @Patch(':id/members/:userId')
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'userId', type: String })
  @ApiOperation({
    summary: 'Update member role or mute status (admin/owner only)',
  })
  updateMember(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.membersService.updateMember(id, user.id, targetUserId, dto);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'userId', type: String })
  @ApiOperation({ summary: 'Remove (kick) a member (admin/owner only)' })
  removeMember(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
  ) {
    return this.membersService.removeMember(id, user.id, targetUserId);
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Leave a room' })
  leave(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.membersService.leaveRoom(id, user.id);
  }

  @Post(':id/transfer-ownership')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Transfer room ownership to another member' })
  transferOwnership(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('newOwnerId', ParseUUIDPipe) newOwnerId: string,
  ) {
    return this.membersService.transferOwnership(id, user.id, newOwnerId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Mark room as read (reset unread count)' })
  markAsRead(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.membersService.markAsRead(id, user.id);
  }

  // ─── Invites ─────────────────────────────────────────

  @Post(':id/invites')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Create an invite link (admin/owner only)' })
  createInvite(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInviteDto,
  ) {
    return this.roomsService.createInvite(id, user.id, dto);
  }

  @Get(':id/invites')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'List invite links (admin/owner only)' })
  getInvites(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.roomsService.getInvites(id, user.id);
  }

  @Delete('invites/:inviteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'inviteId', type: String })
  @ApiOperation({ summary: 'Delete an invite link' })
  deleteInvite(
    @CurrentUser() user: User,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ) {
    return this.roomsService.deleteInvite(inviteId, user.id);
  }
}
