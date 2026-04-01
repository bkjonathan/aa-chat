import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsEnum,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RoomType } from '@prisma/client';

export class SearchRoomsDto {
  @ApiProperty({ example: 'design' })
  @IsString()
  @MinLength(1)
  query: string;

  @ApiPropertyOptional({ enum: RoomType })
  @IsOptional()
  @IsEnum(RoomType)
  type?: RoomType;

  @ApiPropertyOptional({ default: 10, maximum: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit?: number = 10;
}
