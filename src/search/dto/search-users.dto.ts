import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SearchUsersDto {
  @ApiProperty({ example: 'john' })
  @IsString()
  @MinLength(1)
  query: string;

  @ApiPropertyOptional({ default: 10, maximum: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Restrict to members of this room' })
  @IsOptional()
  roomId?: string;
}
