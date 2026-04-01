import {
  IsEnum,
  IsString,
  IsOptional,
  MaxLength,
  IsBoolean,
  IsArray,
  IsUUID,
  ArrayMaxSize,
  ValidateIf,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RoomType } from '@prisma/client';

export class CreateRoomDto {
  @ApiProperty({ enum: RoomType, example: 'group' })
  @IsEnum(RoomType)
  type: RoomType;

  @ApiPropertyOptional({ example: 'Design Team' })
  @ValidateIf((o) => o.type !== RoomType.dm)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'design-team' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  slug?: string;

  @ApiPropertyOptional({ example: 'All things design' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean = false;

  @ApiPropertyOptional({
    type: [String],
    example: ['uuid-1', 'uuid-2'],
    description: 'Initial member IDs to add (excluding creator)',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(100)
  memberIds?: string[] = [];
}
