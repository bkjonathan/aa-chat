import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsNumber,
  IsPositive,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConfirmUploadDto {
  @ApiProperty({ description: 'S3 key returned from presigned URL request' })
  @IsString()
  @IsNotEmpty()
  s3Key: string;

  @ApiProperty({ example: 'uuid-of-room' })
  @IsUUID()
  roomId: string;

  @ApiProperty({ example: 'photo.jpg' })
  @IsString()
  @IsNotEmpty()
  originalName: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @IsNotEmpty()
  contentType: string;

  @ApiProperty({ example: 1024000 })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  sizeBytes: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  messageId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  isPublic?: boolean;
}
