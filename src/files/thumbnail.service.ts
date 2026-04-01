import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';

export interface ThumbnailResult {
  buffer: Buffer;
  width: number;
  height: number;
  contentType: 'image/webp';
}

export interface ImageDimensions {
  width: number;
  height: number;
}

const THUMBNAIL_SIZE = 400; // max dimension for thumbnail
const PREVIEW_SIZE = 1200; // max dimension for large preview

@Injectable()
export class ThumbnailService {
  private readonly logger = new Logger(ThumbnailService.name);

  // ─── Generate thumbnail ───────────────────────────────

  async generateThumbnail(
    buffer: Buffer,
    maxSize = THUMBNAIL_SIZE,
  ): Promise<ThumbnailResult> {
    const { width, height } = await this.getDimensions(buffer);

    const resized = await sharp(buffer)
      .resize(maxSize, maxSize, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: resized.data,
      width: resized.info.width,
      height: resized.info.height,
      contentType: 'image/webp',
    };
  }

  // ─── Generate preview (large images) ─────────────────

  async generatePreview(buffer: Buffer): Promise<ThumbnailResult> {
    return this.generateThumbnail(buffer, PREVIEW_SIZE);
  }

  // ─── Get image dimensions ─────────────────────────────

  async getDimensions(buffer: Buffer): Promise<ImageDimensions> {
    const metadata = await sharp(buffer).metadata();
    return {
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
    };
  }

  // ─── Check if buffer is an image ─────────────────────

  async isValidImage(buffer: Buffer): Promise<boolean> {
    try {
      await sharp(buffer).metadata();
      return true;
    } catch {
      return false;
    }
  }

  // ─── Strip EXIF metadata ──────────────────────────────

  stripMetadata(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
      .rotate() // auto-rotate based on EXIF then strip
      .withMetadata({ exif: {} })
      .toBuffer();
  }
}
