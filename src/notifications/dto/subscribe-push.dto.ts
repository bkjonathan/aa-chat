import {
  IsString,
  IsNotEmpty,
  IsObject,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeviceType } from '@prisma/client';

export class PushSubscriptionKeysDto {
  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  auth: string;
}

export class SubscribePushDto {
  @ApiProperty({ description: 'Browser push subscription endpoint URL' })
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @ApiProperty({ description: 'VAPID encryption keys from browser' })
  @IsObject()
  keys: PushSubscriptionKeysDto;

  @ApiPropertyOptional({ enum: DeviceType, default: DeviceType.web })
  @IsOptional()
  @IsEnum(DeviceType)
  deviceType?: DeviceType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userAgent?: string;
}
