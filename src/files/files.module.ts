import { Module } from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { S3Service } from './s3.service';
import { ThumbnailService } from './thumbnail.service';
import { RoomsModule } from 'src/room/rooms.module';

@Module({
  imports: [RoomsModule],
  controllers: [FilesController],
  providers: [FilesService, S3Service, ThumbnailService],
  exports: [FilesService, S3Service],
})
export class FilesModule {}
