import { IsOptional, IsEnum, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { RoomType } from '@prisma/client';

export class QueryRoomsDto {
  @ApiPropertyOptional({ enum: RoomType })
  @IsOptional()
  @IsEnum(RoomType)
  type?: RoomType;

  @ApiPropertyOptional({ example: 'design' })
  @IsOptional()
  @IsString()
  search?: string;
}
