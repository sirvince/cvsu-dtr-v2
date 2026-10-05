import type { ErrorCode } from '@cvsu-dtr/shared';

/**
 * What kind of failure an error is. The HTTP layer maps it to a status
 * (AllExceptionsFilter); domain code never deals with HTTP.
 */
export type DomainErrorKind =
  | 'VALIDATION' // 400
  | 'UNAUTHENTICATED' // 401
  | 'FORBIDDEN' // 403
  | 'NOT_FOUND' // 404, also used for out-of-scope resources
  | 'CONFLICT' // 409
  | 'PAYLOAD_TOO_LARGE' // 413
  | 'BUSINESS_RULE' // 422
  | 'RATE_LIMITED'; // 429

export interface DomainErrorOptions {
  details?: unknown;
  kind?: DomainErrorKind;
}

/** Base error with a stable code from API-DESIGN §9. Defaults to a business-rule violation (422). */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly kind: DomainErrorKind;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, options: DomainErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.kind = options.kind ?? 'BUSINESS_RULE';
    this.details = options.details ?? null;
  }
}

export class ValidationFailedError extends DomainError {
  constructor(details: readonly FieldError[], message = 'The request is invalid.') {
    super('VALIDATION_ERROR', message, { details, kind: 'VALIDATION' });
  }
}

export interface FieldError {
  field: string;
  message: string;
}

export class NotFoundError extends DomainError {
  constructor(code: ErrorCode = 'NOT_FOUND', message = 'Resource not found.', details?: unknown) {
    super(code, message, { details, kind: 'NOT_FOUND' });
  }
}

export class ConflictError extends DomainError {
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(code, message, { details, kind: 'CONFLICT' });
  }
}
