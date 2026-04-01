import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsUUID,
  IsOptional,
  MaxLength,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RequestUploadDto {
  @ApiProperty({ example: 'photo.jpg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  originalName: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @IsNotEmpty()
  contentType: string;

  @ApiProperty({ example: 1024000, description: 'File size in bytes' })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  sizeBytes: number;

  @ApiProperty({ example: 'uuid-of-room' })
  @IsUUID()
  roomId: string;

  @ApiPropertyOptional({ description: 'Message ID to attach file to' })
  @IsOptional()
  @IsUUID()
  messageId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
