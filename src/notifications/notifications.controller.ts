import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Delete,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { PushNotificationsService } from './push-notifications.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { User } from '@prisma/client';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private notificationsService: NotificationsService,
    private pushService: PushNotificationsService,
  ) {}

  // ─── VAPID public key (no auth needed by browser) ────

  @Public()
  @Get('push/vapid-key')
  @ApiOperation({
    summary: 'Get VAPID public key for browser push subscription',
  })
  getVapidKey() {
    return { publicKey: this.pushService.getVapidPublicKey() };
  }

  // ─── Subscribe to push notifications ─────────────────

  @Post('push/subscribe')
  @ApiOperation({ summary: 'Subscribe device to push notifications' })
  @ApiResponse({ status: 201, description: 'Subscription saved' })
  subscribe(@CurrentUser() user: User, @Body() dto: SubscribePushDto) {
    return this.pushService.subscribe(user.id, dto);
  }

  // ─── Unsubscribe ──────────────────────────────────────

  @Delete('push/subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unsubscribe current device from push notifications',
  })
  unsubscribe(@CurrentUser() user: User, @Body('endpoint') endpoint: string) {
    return this.pushService.unsubscribe(user.id, endpoint);
  }

  @Delete('push/subscribe/all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unsubscribe all devices' })
  unsubscribeAll(@CurrentUser() user: User) {
    return this.pushService.unsubscribeAll(user.id);
  }

  // ─── List subscriptions ───────────────────────────────

  @Get('push/subscriptions')
  @ApiOperation({ summary: 'List active push subscriptions for current user' })
  getSubscriptions(@CurrentUser() user: User) {
    return this.pushService.getUserSubscriptions(user.id);
  }

  // ─── In-app notifications ─────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Get in-app notifications with cursor pagination' })
  getNotifications(
    @CurrentUser() user: User,
    @Query() query: QueryNotificationsDto,
  ) {
    return this.notificationsService.getNotifications(user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification badge count' })
  getUnreadCount(@CurrentUser() user: User) {
    return this.notificationsService.getUnreadCount(user.id);
  }

  @Post('read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark specific notifications as read' })
  markAsRead(@CurrentUser() user: User, @Body('ids') ids: string[]) {
    return this.notificationsService.markAsRead(user.id, ids);
  }

  @Post('read/all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllAsRead(@CurrentUser() user: User) {
    return this.notificationsService.markAllAsRead(user.id);
  }
}
