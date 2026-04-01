import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { S3Service } from './s3.service';
import { ThumbnailService } from './thumbnail.service';
import { RequestUploadDto } from './dto/request-upload.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { RoomMembersService } from '../room/room-members.service';
import * as path from 'path';

const IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
    private thumbnailService: ThumbnailService,
    private roomMembersService: RoomMembersService,
  ) {}

  // ─── Step 1: request presigned upload URL ────────────

  async requestPresignedUrl(uploaderId: string, dto: RequestUploadDto) {
    // Verify room membership
    await this.roomMembersService.requireMembership(dto.roomId, uploaderId);

    // Validate file type and size
    const { valid, category, error } = this.s3.validateFile(
      dto.contentType,
      dto.sizeBytes,
    );
    if (!valid) throw new BadRequestException(error);

    // Build S3 key
    const s3Key = this.s3.buildKey(uploaderId, dto.roomId, dto.originalName);

    // Get presigned PUT URL
    const { uploadUrl, expiresIn } = await this.s3.getPresignedUploadUrl(
      s3Key,
      dto.contentType,
      dto.sizeBytes,
    );

    this.logger.log(
      `Presigned URL issued for ${uploaderId}: ${s3Key} (${category})`,
    );

    return {
      uploadUrl,
      s3Key,
      expiresIn,
      category,
      instructions: {
        method: 'PUT',
        headers: { 'Content-Type': dto.contentType },
        note: 'Upload directly to uploadUrl, then call POST /files/confirm',
      },
    };
  }

  // ─── Step 2: confirm upload, create DB record ─────────

  async confirmUpload(uploaderId: string, dto: ConfirmUploadDto) {
    // Verify room membership
    await this.roomMembersService.requireMembership(dto.roomId, uploaderId);

    // Verify file actually exists in S3
    const exists = await this.s3.objectExists(dto.s3Key);
    if (!exists) {
      throw new BadRequestException(
        'File not found in S3. Complete the upload before confirming.',
      );
    }

    const isImage = IMAGE_CONTENT_TYPES.includes(dto.contentType);
    let thumbnailKey: string | null = null;
    let width: number | null = null;
    let height: number | null = null;

    // ── Generate thumbnail for images ─────────────────
    // Note: in production replace with a Lambda/SQS async job
    // For MVP we generate synchronously only for small files
    if (isImage && dto.sizeBytes < 10 * 1024 * 1024) {
      try {
        const { buffer, dimensions } = await this.downloadAndProcess(
          dto.s3Key,
          dto.contentType,
        );

        width = dimensions.width;
        height = dimensions.height;

        thumbnailKey = this.s3.buildThumbnailKey(dto.s3Key);
        await this.s3.uploadBuffer(thumbnailKey, buffer, 'image/webp');

        this.logger.log(`Thumbnail generated: ${thumbnailKey}`);
      } catch (err) {
        this.logger.warn(`Thumbnail generation failed for ${dto.s3Key}:`, err);
        // Non-fatal: continue without thumbnail
      }
    }

    // Create DB record
    const file = await this.prisma.file.create({
      data: {
        uploaderId,
        roomId: dto.roomId,
        messageId: dto.messageId ?? null,
        originalName: dto.originalName,
        s3Key: dto.s3Key,
        s3Bucket: this.s3.getBucket(),
        contentType: dto.contentType,
        sizeBytes: dto.sizeBytes,
        width,
        height,
        thumbnailKey,
        isPublic: dto.isPublic ?? false,
      },
    });

    this.logger.log(`File record created: ${file.id}`);
    return file;
  }

  // ─── Get download URL ─────────────────────────────────

  async getDownloadUrl(fileId: string, requestingUserId: string) {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!file) throw new NotFoundException('File not found');

    // Verify access: must be in the room
    if (file.roomId) {
      await this.roomMembersService.requireMembership(
        file.roomId,
        requestingUserId,
      );
    } else if (file.uploaderId !== requestingUserId) {
      throw new ForbiddenException('Access denied');
    }

    const { downloadUrl } = await this.s3.getPresignedDownloadUrl(file.s3Key);

    let thumbnailUrl: string | null = null;
    if (file.thumbnailKey) {
      const { downloadUrl: thumbUrl } = await this.s3.getPresignedDownloadUrl(
        file.thumbnailKey,
      );
      thumbnailUrl = thumbUrl;
    }

    return {
      file,
      downloadUrl,
      thumbnailUrl,
    };
  }

  // ─── Get files in a room ──────────────────────────────

  async getRoomFiles(
    roomId: string,
    requestingUserId: string,
    contentType?: string,
  ) {
    await this.roomMembersService.requireMembership(roomId, requestingUserId);

    const files = await this.prisma.file.findMany({
      where: {
        roomId,
        ...(contentType && {
          contentType: { contains: contentType },
        }),
      },
      include: {
        uploader: {
          select: { id: true, username: true, displayName: true },
        },
      },
      orderBy: { uploadedAt: 'desc' },
      take: 50,
    });

    // Enrich with presigned URLs
    return Promise.all(
      files.map(async (file) => {
        const { downloadUrl } = await this.s3.getPresignedDownloadUrl(
          file.s3Key,
          300, // short TTL for list view
        );
        return { ...file, downloadUrl };
      }),
    );
  }

  // ─── Delete file ──────────────────────────────────────

  async deleteFile(fileId: string, requestingUserId: string) {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!file) throw new NotFoundException('File not found');
    if (file.uploaderId !== requestingUserId) {
      throw new ForbiddenException('You can only delete your own files');
    }

    // Delete from S3
    await this.s3.deleteObject(file.s3Key);
    if (file.thumbnailKey) {
      await this.s3.deleteObject(file.thumbnailKey).catch(() => {});
    }

    // Delete DB record
    await this.prisma.file.delete({ where: { id: fileId } });
  }

  // ─── Private: download from S3 and process ───────────

  private async downloadAndProcess(
    s3Key: string,
    contentType: string,
  ): Promise<{
    buffer: Buffer;
    dimensions: { width: number; height: number };
  }> {
    // For thumbnail generation we need the raw bytes
    // In MVP: re-fetch from S3 using a private GET
    // In production: use S3 trigger → Lambda → SQS
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');

    throw new Error(
      'Direct S3 download not implemented in service layer. ' +
        'Use Lambda trigger for production thumbnail generation. ' +
        'For local dev: accept image buffer directly via multipart endpoint.',
    );
  }

  // ─── Server-side upload (dev / avatar use) ───────────

  async uploadBuffer(
    uploaderId: string,
    roomId: string | null,
    originalName: string,
    contentType: string,
    buffer: Buffer,
    isPublic = false,
  ) {
    const { valid, category, error } = this.s3.validateFile(
      contentType,
      buffer.length,
    );
    if (!valid) throw new BadRequestException(error);

    const s3Key = this.s3.buildKey(
      uploaderId,
      roomId ?? 'avatars',
      originalName,
      roomId ? 'uploads' : 'avatars',
    );

    let thumbnailKey: string | null = null;
    let width: number | null = null;
    let height: number | null = null;

    const isImage = IMAGE_CONTENT_TYPES.includes(contentType);

    if (isImage) {
      const dims = await this.thumbnailService.getDimensions(buffer);
      width = dims.width;
      height = dims.height;

      const thumb = await this.thumbnailService.generateThumbnail(buffer);
      thumbnailKey = this.s3.buildThumbnailKey(s3Key);
      await this.s3.uploadBuffer(thumbnailKey, thumb.buffer, 'image/webp');
    }

    // Upload original
    await this.s3.uploadBuffer(s3Key, buffer, contentType);

    const file = await this.prisma.file.create({
      data: {
        uploaderId,
        roomId,
        originalName,
        s3Key,
        s3Bucket: this.s3.getBucket(),
        contentType,
        sizeBytes: buffer.length,
        width,
        height,
        thumbnailKey,
        isPublic,
      },
    });

    return {
      file,
      url: isPublic
        ? this.s3.getPublicUrl(s3Key)
        : (await this.s3.getPresignedDownloadUrl(s3Key)).downloadUrl,
    };
  }
}
