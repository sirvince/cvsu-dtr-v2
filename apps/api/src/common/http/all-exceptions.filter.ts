import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ErrorCode } from '@cvsu-dtr/shared';
import type { Request, Response } from 'express';
import { DomainError, type DomainErrorKind } from '../domain/domain-error';

/** API-DESIGN §9 error envelope. */
export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details: unknown;
    requestId: string | null;
    timestamp: string;
  };
}

const STATUS_BY_KIND: Record<DomainErrorKind, number> = {
  VALIDATION: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  PAYLOAD_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  BUSINESS_RULE: HttpStatus.UNPROCESSABLE_ENTITY,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
};

const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

const GENERIC_MESSAGE: Partial<Record<number, string>> = {
  401: 'Authentication is required.',
  403: 'You do not have permission to do this.',
  404: 'Resource not found.',
  413: 'The request body is too large.',
  429: 'Too many requests. Try again later.',
  503: 'The service is not ready.',
};

const INTERNAL_MESSAGE = 'An unexpected error occurred.';

interface Mapped {
  status: number;
  code: ErrorCode;
  message: string;
  details: unknown;
}

/**
 * The one place errors become HTTP responses (DESIGN-PATTERNS §8).
 * Stack traces and internal messages only ever go to the log.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();
    const mapped = this.map(exception);

    if (mapped.status >= 500 && mapped.status !== 503) {
      this.logger.error({ err: exception, path: req.originalUrl }, 'Unhandled error');
    }

    const body: ErrorBody = {
      error: {
        code: mapped.code,
        message: mapped.message,
        details: mapped.details,
        requestId: req.id ?? null,
        timestamp: new Date().toISOString(),
      },
    };
    res.status(mapped.status).json(body);
  }

  private map(exception: unknown): Mapped {
    if (exception instanceof DomainError) {
      return {
        status: STATUS_BY_KIND[exception.kind],
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      return this.mapHttpException(exception);
    }

    const clientError = asExposedClientError(exception);
    if (clientError) return clientError;

    return { status: 500, code: 'INTERNAL_ERROR', message: INTERNAL_MESSAGE, details: null };
  }

  /** Framework exceptions: unknown routes, ParseUUIDPipe, throttler, terminus… */
  private mapHttpException(exception: HttpException): Mapped {
    const status = exception.getStatus();
    if (status >= 500 && status !== 503) {
      return { status, code: 'INTERNAL_ERROR', message: INTERNAL_MESSAGE, details: null };
    }
    const code = CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR');
    // Terminus puts the health report in the 503 body; nothing else needs its body echoed.
    const details = status === 503 ? exception.getResponse() : null;
    const message = GENERIC_MESSAGE[status] ?? exception.message;
    return { status, code, message, details };
  }
}

/**
 * `http-errors` objects thrown by Express middleware before Nest is involved: body-parser
 * (oversized or malformed body), later multer. Only 4xx errors marked `expose` are trusted.
 */
function asExposedClientError(exception: unknown): Mapped | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const { status, expose } = exception as { status?: unknown; expose?: unknown };
  if (typeof status !== 'number' || status < 400 || status >= 500 || expose !== true) return null;

  const code = CODE_BY_STATUS[status] ?? 'VALIDATION_ERROR';
  const message =
    GENERIC_MESSAGE[status] ??
    (status === 400 ? 'The request body is invalid.' : 'The request was rejected.');
  return { status, code, message, details: null };
}
