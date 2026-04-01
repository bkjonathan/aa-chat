import {
  IsString,
  IsOptional,
  IsUUID,
  IsEnum,
  MaxLength,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageType } from '@prisma/client';

export class CreateMessageDto {
  @ApiProperty({ example: 'uuid-of-room' })
  @IsUUID()
  roomId: string;

  @ApiPropertyOptional({ example: 'Hello world!' })
  @ValidateIf((o) => o.type === MessageType.text || !o.type)
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content?: string;

  @ApiPropertyOptional({ enum: MessageType, default: MessageType.text })
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType = MessageType.text;

  @ApiPropertyOptional({ description: 'Parent message ID for thread replies' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ description: 'File ID from Phase 6 upload' })
  @IsOptional()
  @IsUUID()
  fileId?: string;
}
