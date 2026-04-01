import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { InvitesController } from './invites.controller';
import { RoomMembersService } from './room-members.service';

@Module({
  controllers: [RoomsController, InvitesController],
  providers: [RoomsService, RoomMembersService],
  exports: [RoomsService, RoomMembersService],
})
export class RoomsModule {}
