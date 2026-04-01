import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { User } from '@prisma/client';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  // ─── Search users ────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Search users' })
  findAll(@Query() query: QueryUsersDto) {
    return this.usersService.findMany(query);
  }

  // ─── Get own profile ─────────────────────────────────

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  getMe(@CurrentUser() user: User) {
    return this.usersService.sanitize(user);
  }

  // ─── Get user by ID ──────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', type: String })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.usersService.findByIdOrThrow(id);
    return this.usersService.sanitize(user);
  }

  // ─── Update profile ──────────────────────────────────

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  updateMe(@CurrentUser() user: User, @Body() dto: UpdateUserDto) {
    return this.usersService.update(user.id, dto);
  }

  // ─── Avatar upload placeholder ───────────────────────

  @Post('me/avatar')
  @ApiOperation({
    summary: 'Update avatar (placeholder — full S3 upload in Phase 6)',
  })
  @ApiResponse({ status: 200, description: 'Avatar URL updated' })
  updateAvatar(
    @CurrentUser() user: User,
    @Body('avatarUrl') avatarUrl: string,
  ) {
    return this.usersService.updateAvatar(user.id, avatarUrl);
  }

  // ─── Settings ────────────────────────────────────────

  @Get('me/settings')
  @ApiOperation({ summary: 'Get user settings' })
  getSettings(@CurrentUser() user: User) {
    return this.usersService.getSettings(user.id);
  }

  @Patch('me/settings')
  @ApiOperation({ summary: 'Update user settings' })
  updateSettings(@CurrentUser() user: User, @Body() dto: UpdateSettingsDto) {
    return this.usersService.updateSettings(user.id, dto);
  }

  // ─── Block / unblock ─────────────────────────────────

  @Post('block/:id')
  @ApiOperation({ summary: 'Block a user' })
  @ApiParam({ name: 'id', type: String })
  blockUser(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) targetId: string,
  ) {
    return this.usersService.blockUser(user.id, targetId);
  }

  @Delete('block/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unblock a user' })
  @ApiParam({ name: 'id', type: String })
  unblockUser(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) targetId: string,
  ) {
    return this.usersService.unblockUser(user.id, targetId);
  }

  @Get('me/blocked')
  @ApiOperation({ summary: 'Get list of blocked users' })
  getBlocked(@CurrentUser() user: User) {
    return this.usersService.getBlockedUsers(user.id);
  }
}
