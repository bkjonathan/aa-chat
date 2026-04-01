import {
  IsBoolean,
  IsOptional,
  IsEnum,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Theme } from '@prisma/client';

export class UpdateSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notificationSound?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  desktopNotifications?: boolean;

  @ApiPropertyOptional({ enum: Theme })
  @IsOptional()
  @IsEnum(Theme)
  theme?: Theme;

  @ApiPropertyOptional({ example: 'en' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;

  @ApiPropertyOptional({ example: 'Asia/Bangkok' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
