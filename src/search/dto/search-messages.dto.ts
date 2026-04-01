import {
  IsString,
  IsOptional,
  IsUUID,
  IsDateString,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SearchSortOrder {
  RELEVANCE = 'relevance',
  NEWEST = 'newest',
  OLDEST = 'oldest',
}

export class SearchMessagesDto {
  @ApiProperty({ example: 'hello world' })
  @IsString()
  query: string;

  @ApiPropertyOptional({ description: 'Restrict to a specific room' })
  @IsOptional()
  @IsUUID()
  roomId?: string;

  @ApiPropertyOptional({ description: 'Filter by sender user ID' })
  @IsOptional()
  @IsUUID()
  senderId?: string;

  @ApiPropertyOptional({ description: 'Messages after this date' })
  @IsOptional()
  @IsDateString()
  after?: string;

  @ApiPropertyOptional({ description: 'Messages before this date' })
  @IsOptional()
  @IsDateString()
  before?: string;

  @ApiPropertyOptional({
    enum: SearchSortOrder,
    default: SearchSortOrder.RELEVANCE,
  })
  @IsOptional()
  @IsEnum(SearchSortOrder)
  sort?: SearchSortOrder = SearchSortOrder.RELEVANCE;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @ApiPropertyOptional({ description: 'Include thread replies in results' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeThreads?: boolean = false;
}
