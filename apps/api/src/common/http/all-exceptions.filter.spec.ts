import {
  type ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import {
  ConflictError,
  DomainError,
  NotFoundError,
  ValidationFailedError,
} from '../domain/domain-error';
import { InvalidTransitionError } from '../domain/state-machine';
import { AllExceptionsFilter, type ErrorBody } from './all-exceptions.filter';

function run(exception: unknown) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const req = { id: 'req_test', originalUrl: '/api/v1/x' };
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  const status = (res.status.mock.calls[0] as [number])[0];
  const body = (res.json.mock.calls[0] as [ErrorBody])[0];
  return { status, body };
}

describe('AllExceptionsFilter', () => {
  let logError: jest.SpyInstance;
  beforeEach(() => {
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => logError.mockRestore());

  it('maps a DomainError to 422 with its code, message and details', () => {
    const { status, body } = run(
      new DomainError('DTR_HAS_BLOCKING_FLAGS', 'DTR has 3 blocking days.', {
        details: { count: 3 },
      }),
    );
    expect(status).toBe(422);
    expect(body.error).toEqual({
      code: 'DTR_HAS_BLOCKING_FLAGS',
      message: 'DTR has 3 blocking days.',
      details: { count: 3 },
      requestId: 'req_test',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
    });
  });

  it.each<[string, Error, number, string]>([
    [
      'validation',
      new ValidationFailedError([{ field: 'name', message: 'required' }]),
      400,
      'VALIDATION_ERROR',
    ],
    [
      'not found / out of scope',
      new NotFoundError('DTR_NOT_FOUND', 'DTR not found.'),
      404,
      'DTR_NOT_FOUND',
    ],
    [
      'conflict',
      new ConflictError('CONCURRENT_MODIFICATION', 'Changed by someone else.'),
      409,
      'CONCURRENT_MODIFICATION',
    ],
    [
      'invalid transition',
      new InvalidTransitionError('DTR_INVALID_TRANSITION', 'FINALIZED', 'finalize'),
      422,
      'DTR_INVALID_TRANSITION',
    ],
  ])('maps %s', (_name, error, status, code) => {
    const result = run(error);
    expect(result.status).toBe(status);
    expect(result.body.error.code).toBe(code);
  });

  it.each<[string, HttpException, number, string]>([
    ['unknown route', new NotFoundException('Cannot GET /api/v1/nope'), 404, 'NOT_FOUND'],
    [
      'framework 400',
      new BadRequestException('Validation failed (uuid is expected)'),
      400,
      'VALIDATION_ERROR',
    ],
    ['403', new ForbiddenException(), 403, 'FORBIDDEN'],
    ['throttler', new ThrottlerException(), 429, 'RATE_LIMITED'],
  ])('maps a framework HttpException: %s', (_name, error, status, code) => {
    const result = run(error);
    expect(result.status).toBe(status);
    expect(result.body.error.code).toBe(code);
  });

  it('uses a generic message for unknown routes (no path echo)', () => {
    expect(run(new NotFoundException('Cannot GET /api/v1/nope')).body.error.message).toBe(
      'Resource not found.',
    );
  });

  it('keeps the health report on 503', () => {
    const report = { status: 'error', error: { database: { status: 'down' } } };
    const { status, body } = run(new ServiceUnavailableException(report));
    expect(status).toBe(503);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.error.details).toEqual(report);
  });

  it('hides unexpected errors behind a generic 500 and logs the stack', () => {
    const boom = new Error('connection to 10.0.0.5 refused at db.ts:42');
    const { status, body } = run(boom);
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ err: boom }),
      'Unhandled error',
    );
  });

  it('maps exposed http-errors from Express middleware (body-parser)', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      expose: true,
      type: 'entity.too.large',
    });
    expect(run(tooLarge)).toMatchObject({
      status: 413,
      body: { error: { code: 'PAYLOAD_TOO_LARGE' } },
    });

    const malformed = Object.assign(new SyntaxError('Unexpected token b'), {
      status: 400,
      expose: true,
    });
    expect(run(malformed)).toMatchObject({
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR', message: 'The request body is invalid.' } },
    });
  });

  it('does not trust a status on an unexposed or 5xx error', () => {
    expect(run(Object.assign(new Error('x'), { status: 404, expose: false })).status).toBe(500);
    expect(run(Object.assign(new Error('x'), { status: 502, expose: true })).status).toBe(500);
  });

  it('does not log expected 4xx errors as unhandled', () => {
    run(new NotFoundError());
    expect(logError).not.toHaveBeenCalled();
  });
});
