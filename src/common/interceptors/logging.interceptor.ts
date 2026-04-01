import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger as WinstonLogger } from 'winston';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly logger: WinstonLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const startTime = Date.now();

    const requestId =
      (req.headers['x-request-id'] as string) ||
      `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Attach request ID to response header
    res.setHeader('x-request-id', requestId);

    const { method, url, ip } = req;
    const userAgent = req.headers['user-agent'] || '';
    const userId = (req as any).user?.id;

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        const statusCode = res.statusCode;

        this.logger.info('HTTP request', {
          requestId,
          method,
          url,
          statusCode,
          duration: `${duration}ms`,
          ip,
          userId,
          userAgent: userAgent.slice(0, 100),
        });

        // Warn on slow requests
        if (duration > 1000) {
          this.logger.warn('Slow request detected', {
            requestId,
            method,
            url,
            duration: `${duration}ms`,
          });
        }
      }),
      catchError((err) => {
        const duration = Date.now() - startTime;
        this.logger.error('HTTP request failed', {
          requestId,
          method,
          url,
          duration: `${duration}ms`,
          error: err.message,
          stack: err.stack,
          ip,
          userId,
        });
        return throwError(() => err);
      }),
    );
  }
}
