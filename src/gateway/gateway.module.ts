import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ChatGateway } from './chat.gateway';
import { PresenceService } from './presence.service';
import { WsJwtMiddleware } from './ws-jwt.middleware';
import { WsJwtGuard } from './ws-jwt.guard';
import { UsersModule } from '../users/users.module';
import { MessagesModule } from '../messages/messages.module';
import { RoomsModule } from 'src/room/rooms.module';

@Module({
  imports: [JwtModule.register({}), UsersModule, RoomsModule, MessagesModule],
  providers: [ChatGateway, PresenceService, WsJwtMiddleware, WsJwtGuard],
  exports: [ChatGateway, PresenceService],
})
export class GatewayModule {}
