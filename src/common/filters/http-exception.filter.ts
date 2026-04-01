import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger as WinstonLogger } from 'winston';
import { Prisma } from '@prisma/client';
import { WsException } from '@nestjs/websockets';
import { ThrottlerException } from '@nestjs/throttler';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly logger: WinstonLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    // WebSocket context — handled separately
    if (host.getType() === 'ws') {
      const client = host.switchToWs().getClient();
      const error = this.normaliseWsError(exception);
      client.emit('error', error);
      return;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message, code } = this.normaliseError(exception);

    const requestId = response.getHeader('x-request-id') as string | undefined;

    const errorResponse = {
      success: false,
      statusCode: status,
      code,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      ...(requestId && { requestId }),
    };

    if (status >= 500) {
      this.logger.error('Unhandled exception', {
        error:
          exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
        path: request.url,
        method: request.method,
        userId: (request as any).user?.id,
        requestId,
      });
    } else if (status === 429) {
      this.logger.warn('Rate limit exceeded', {
        path: request.url,
        ip: request.ip,
        userId: (request as any).user?.id,
      });
    }

    response.status(status).json(errorResponse);
  }

  private normaliseError(exception: unknown): {
    status: number;
    message: string | string[];
    code: string;
  } {
    // NestJS HTTP exceptions
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const status = exception.getStatus();

      const message =
        typeof response === 'object' && 'message' in (response as object)
          ? (response as any).message
          : exception.message;

      // Rate limit specific code
      if (exception instanceof ThrottlerException) {
        return { status, message, code: 'RATE_LIMIT_EXCEEDED' };
      }

      const code = this.statusToCode(status);
      return { status, message, code };
    }

    // Prisma known errors
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.handlePrismaError(exception);
    }

    // Prisma validation errors
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Database validation error',
        code: 'VALIDATION_ERROR',
      };
    }

    // Unknown errors
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    };
  }

  private handlePrismaError(err: Prisma.PrismaClientKnownRequestError): {
    status: number;
    message: string;
    code: string;
  } {
    switch (err.code) {
      case 'P2002': {
        const fields = (err.meta?.target as string[])?.join(', ') || 'field';
        return {
          status: HttpStatus.CONFLICT,
          message: `${fields} already exists`,
          code: 'DUPLICATE_ENTRY',
        };
      }
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'Record not found',
          code: 'NOT_FOUND',
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Foreign key constraint violation',
          code: 'INVALID_REFERENCE',
        };
      case 'P2014':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Relation violation',
          code: 'RELATION_ERROR',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Database error',
          code: 'DATABASE_ERROR',
        };
    }
  }

  private normaliseWsError(exception: unknown): { message: string } {
    if (exception instanceof WsException) {
      const error = exception.getError();
      return {
        message:
          typeof error === 'string'
            ? error
            : (error as any)?.message || 'WebSocket error',
      };
    }
    if (exception instanceof HttpException) {
      return { message: exception.message };
    }
    return { message: 'Internal server error' };
  }

  private statusToCode(status: number): string {
    const codes: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      405: 'METHOD_NOT_ALLOWED',
      409: 'CONFLICT',
      410: 'GONE',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'RATE_LIMIT_EXCEEDED',
      500: 'INTERNAL_ERROR',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE',
    };
    return codes[status] || 'ERROR';
  }
}
