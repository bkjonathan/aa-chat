import { Module, forwardRef } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { RoomsModule } from 'src/room/rooms.module';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [RoomsModule, forwardRef(() => NotificationsModule)],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
