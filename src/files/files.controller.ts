import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService } from './files.service';
import { RequestUploadDto } from './dto/request-upload.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { User } from '@prisma/client';

@ApiTags('files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(private filesService: FilesService) {}

  // ─── Step 1: get presigned upload URL ────────────────

  @Post('presigned-url')
  @ApiOperation({
    summary: 'Get a presigned S3 URL for direct browser upload',
    description:
      'Returns a PUT URL. Client uploads directly to S3, then calls POST /files/confirm.',
  })
  requestPresignedUrl(
    @CurrentUser() user: User,
    @Body() dto: RequestUploadDto,
  ) {
    return this.filesService.requestPresignedUrl(user.id, dto);
  }

  // ─── Step 2: confirm upload completed ────────────────

  @Post('confirm')
  @ApiOperation({
    summary: 'Confirm S3 upload completed and create file record',
    description: 'Call after successfully uploading to the presigned URL.',
  })
  confirmUpload(@CurrentUser() user: User, @Body() dto: ConfirmUploadDto) {
    return this.filesService.confirmUpload(user.id, dto);
  }

  // ─── Server-side upload (for avatars, small files) ───

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        roomId: { type: 'string' },
      },
    },
  })
  @ApiOperation({ summary: 'Server-side upload (avatars and small files)' })
  async uploadDirect(
    @CurrentUser() user: User,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 })],
      }),
    )
    file: Express.Multer.File,
    @Body('roomId') roomId?: string,
  ) {
    return this.filesService.uploadBuffer(
      user.id,
      roomId ?? null,
      file.originalname,
      file.mimetype,
      file.buffer,
    );
  }

  // ─── Get download URL ─────────────────────────────────

  @Get(':id/url')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Get presigned download URL for a file' })
  getDownloadUrl(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) fileId: string,
  ) {
    return this.filesService.getDownloadUrl(fileId, user.id);
  }

  // ─── Room file list ───────────────────────────────────

  @Get('rooms/:roomId')
  @ApiParam({ name: 'roomId', type: String })
  @ApiOperation({ summary: 'Get all files in a room' })
  getRoomFiles(
    @CurrentUser() user: User,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query('type') contentType?: string,
  ) {
    return this.filesService.getRoomFiles(roomId, user.id, contentType);
  }

  // ─── Delete file ──────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Delete a file (uploader only)' })
  deleteFile(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) fileId: string,
  ) {
    return this.filesService.deleteFile(fileId, user.id);
  }
}
