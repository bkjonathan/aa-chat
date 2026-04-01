import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateMessageDto {
  @ApiProperty({ example: 'Edited message content' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content: string;
}
