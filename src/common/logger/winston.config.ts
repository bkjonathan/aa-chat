import * as winston from 'winston';
import { utilities as nestWinstonModuleUtilities } from 'nest-winston';
import * as path from 'path';

const { combine, timestamp, errors, json, colorize } = winston.format;

// ─── Custom format for development console ────────────

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  errors({ stack: true }),
  nestWinstonModuleUtilities.format.nestLike('ChatApp', {
    prettyPrint: true,
    colors: true,
  }),
);

// ─── JSON format for production / log aggregators ─────

const prodFormat = combine(timestamp(), errors({ stack: true }), json());

// ─── File transports ──────────────────────────────────

function buildFileTransports(logDir: string): winston.transport[] {
  return [
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 20 * 1024 * 1024, // 20 MB
      maxFiles: 10,
      tailable: true,
      format: prodFormat,
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 50 * 1024 * 1024, // 50 MB
      maxFiles: 10,
      tailable: true,
      format: prodFormat,
    }),
  ];
}

// ─── Factory ──────────────────────────────────────────

export function createWinstonConfig(
  nodeEnv: string,
  logLevel: string,
  logDir: string,
): winston.LoggerOptions {
  const isDev = nodeEnv !== 'production';

  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: isDev ? devFormat : prodFormat,
      silent: nodeEnv === 'test',
    }),
  ];

  if (!isDev) {
    transports.push(...buildFileTransports(logDir));
  }

  return {
    level: logLevel,
    transports,
    exitOnError: false,
    // Handle uncaught exceptions and unhandled rejections
    exceptionHandlers: isDev
      ? undefined
      : [
          new winston.transports.File({
            filename: path.join(logDir, 'exceptions.log'),
            format: prodFormat,
          }),
        ],
    rejectionHandlers: isDev
      ? undefined
      : [
          new winston.transports.File({
            filename: path.join(logDir, 'rejections.log'),
            format: prodFormat,
          }),
        ],
  };
}
