import {
  IsOptional,
  IsUUID,
  IsInt,
  Min,
  Max,
  IsString,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryMessagesDto {
  @ApiPropertyOptional({
    description: 'Cursor: last message ID from previous page',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 30;

  @ApiPropertyOptional({ description: 'Load thread replies for this message' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ description: 'Search within room messages' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Load messages before this date' })
  @IsOptional()
  @IsDateString()
  before?: string;

  @ApiPropertyOptional({ description: 'Load messages after this date' })
  @IsOptional()
  @IsDateString()
  after?: string;
}
