import { IsEnum, IsOptional, IsBoolean, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MemberRole } from '@prisma/client';

export class UpdateMemberDto {
  @ApiPropertyOptional({ enum: MemberRole })
  @IsOptional()
  @IsEnum(MemberRole)
  role?: MemberRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMuted?: boolean;

  @ApiPropertyOptional({ example: '2025-12-31T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  mutedUntil?: string;
}
