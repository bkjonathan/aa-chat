import {
  IsString,
  IsUUID,
  IsOptional,
  IsEnum,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';
import { MessageType } from '@prisma/client';

export class JoinRoomDto {
  @IsUUID()
  roomId: string;
}

export class LeaveRoomDto {
  @IsUUID()
  roomId: string;
}

export class SendMessageDto {
  @IsUUID()
  roomId: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  content?: string;

  @IsEnum(MessageType)
  type: MessageType = MessageType.text;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsString()
  fileId?: string;

  @IsOptional()
  @IsString()
  clientMessageId?: string; // client-generated idempotency key
}

export class TypingDto {
  @IsUUID()
  roomId: string;
}

export class ReadReceiptDto {
  @IsUUID()
  roomId: string;

  @IsUUID()
  messageId: string;
}

export class UpdateStatusDto {
  @IsEnum(['online', 'away', 'dnd'])
  status: 'online' | 'away' | 'dnd';
}

export class ReactToMessageDto {
  @IsUUID()
  messageId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  emoji: string;
}
