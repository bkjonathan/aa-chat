import { Controller, Post, Param, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
} from '@nestjs/swagger';
import { RoomsService } from './rooms.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { User } from '@prisma/client';

@ApiTags('invites')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('invites')
export class InvitesController {
  constructor(private roomsService: RoomsService) {}

  @Post(':code/join')
  @ApiParam({ name: 'code', type: String })
  @ApiOperation({ summary: 'Join a room using an invite code' })
  join(@CurrentUser() user: User, @Param('code') code: string) {
    return this.roomsService.useInvite(code, user.id);
  }
}
