import { IsOptional, IsInt, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInviteDto {
  @ApiPropertyOptional({
    example: 10,
    description: 'Max number of uses (null = unlimited)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  maxUses?: number;

  @ApiPropertyOptional({ example: '2025-12-31T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
