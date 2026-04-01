import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { createWinstonConfig } from './winston.config';

@Global()
@Module({
  imports: [
    WinstonModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const nodeEnv =
          configService.get<string>('app.nodeEnv') || 'development';
        const logLevel = configService.get<string>('LOG_LEVEL') || 'info';
        const logDir = configService.get<string>('LOG_DIR') || 'logs';

        return createWinstonConfig(nodeEnv, logLevel, logDir);
      },
    }),
  ],
  exports: [WinstonModule],
})
export class LoggerModule {}
