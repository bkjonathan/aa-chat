import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

export interface PresignedUploadResult {
  uploadUrl: string;
  s3Key: string;
  fileId: string;
  expiresIn: number;
  fields?: Record<string, string>;
}

export interface PresignedDownloadResult {
  downloadUrl: string;
  expiresIn: number;
}

// Allowed MIME types grouped by category
const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  image: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
  ],
  video: ['video/mp4', 'video/webm', 'video/ogg'],
  audio: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm'],
  document: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
  ],
};

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

@Injectable()
export class S3Service implements OnModuleInit {
  private readonly logger = new Logger(S3Service.name);
  private client: S3Client;
  private bucket: string;
  private region: string;
  private presignedExpiry: number;
  private cloudFrontUrl: string | null;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.region = this.configService.get<string>('aws.region') ?? '';
    this.bucket = this.configService.get<string>('aws.s3Bucket') ?? '';
    this.presignedExpiry =
      this.configService.get<number>('aws.s3PresignedUrlExpiry') ?? 3600;
    this.cloudFrontUrl =
      this.configService.get<string>('aws.cloudFrontUrl') ?? null;

    this.client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: this.configService.get<string>('aws.accessKeyId') ?? '',
        secretAccessKey:
          this.configService.get<string>('aws.secretAccessKey') ?? '',
      },
    });

    this.logger.log(`S3 client initialised — bucket: ${this.bucket}`);
  }

  // ─── Validate file ────────────────────────────────────

  validateFile(
    contentType: string,
    sizeBytes: number,
  ): { valid: boolean; category: string; error?: string } {
    if (sizeBytes > MAX_FILE_SIZE) {
      return {
        valid: false,
        category: '',
        error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      };
    }

    for (const [category, types] of Object.entries(ALLOWED_MIME_TYPES)) {
      if (types.includes(contentType)) {
        return { valid: true, category };
      }
    }

    return {
      valid: false,
      category: '',
      error: `File type ${contentType} is not allowed`,
    };
  }

  // ─── Build S3 key ─────────────────────────────────────

  buildKey(
    uploaderId: string,
    roomId: string,
    originalName: string,
    prefix = 'uploads',
  ): string {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const ext = path.extname(originalName).toLowerCase();
    const fileId = uuidv4();
    return `${prefix}/${date}/${uploaderId}/${roomId}/${fileId}${ext}`;
  }

  buildThumbnailKey(originalKey: string): string {
    const ext = path.extname(originalKey);
    const base = originalKey.slice(0, -ext.length);
    return `${base}_thumb.webp`;
  }

  // ─── Generate presigned upload URL ───────────────────

  async getPresignedUploadUrl(
    s3Key: string,
    contentType: string,
    sizeBytes: number,
  ): Promise<PresignedUploadResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
      ContentType: contentType,
      ContentLength: sizeBytes,
      Metadata: {
        uploadedAt: new Date().toISOString(),
      },
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: this.presignedExpiry,
    });

    return {
      uploadUrl,
      s3Key,
      fileId: uuidv4(), // placeholder — real DB id created after upload confirms
      expiresIn: this.presignedExpiry,
    };
  }

  // ─── Generate presigned download URL ─────────────────

  async getPresignedDownloadUrl(
    s3Key: string,
    expiresIn = 3600,
  ): Promise<PresignedDownloadResult> {
    // If CloudFront is configured, use it directly (no presigning needed)
    if (this.cloudFrontUrl) {
      return {
        downloadUrl: `${this.cloudFrontUrl}/${s3Key}`,
        expiresIn: 0,
      };
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
    });

    const downloadUrl = await getSignedUrl(this.client, command, {
      expiresIn,
    });

    return { downloadUrl, expiresIn };
  }

  // ─── Upload buffer directly (used for thumbnails) ────

  async uploadBuffer(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    await this.client.send(command);
    this.logger.debug(`Uploaded buffer to S3: ${key}`);
  }

  // ─── Delete object ────────────────────────────────────

  async deleteObject(s3Key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
    });
    await this.client.send(command);
  }

  // ─── Check object exists ──────────────────────────────

  async objectExists(s3Key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: s3Key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  // ─── Public URL (for public objects) ─────────────────

  getPublicUrl(s3Key: string): string {
    if (this.cloudFrontUrl) {
      return `${this.cloudFrontUrl}/${s3Key}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${s3Key}`;
  }

  getBucket(): string {
    return this.bucket;
  }
}
