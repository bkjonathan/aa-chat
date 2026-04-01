import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PinMessageDto {
  @ApiProperty()
  @IsUUID()
  messageId: string;
}
