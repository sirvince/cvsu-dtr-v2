import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';

export const REQUEST_ID_HEADER = 'x-request-id';

// Accept a caller's ID only if it is short and log-safe; anything else gets a fresh one.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** SECURITY-PRIVACY §4: never log credentials or session material. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
];

/**
 * Accepts a safe caller-supplied `X-Request-Id` or generates one, echoes it on the response,
 * and stores it on `req.id`. Runs as the very first middleware (before body parsing), so even
 * a rejected body gets an ID; pino-http then reuses it.
 */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  // `req.id` is declared by pino-http (string | number | object); ours are always strings.
  if (typeof req.id === 'string') return req.id;
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
      ? incoming
      : `req_${randomUUID().replaceAll('-', '')}`;
  res.setHeader('X-Request-Id', id);
  req.id = id;
  return id;
}

export interface PinoOptionsInput {
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
}

export function buildPinoHttpOptions({ nodeEnv, logLevel }: PinoOptionsInput): Options {
  return {
    level: logLevel,
    genReqId: resolveRequestId,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    // Probes would drown the log; failures still show up through the exception filter.
    autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
    customLogLevel: (_req, res, err) =>
      err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    ...(nodeEnv === 'development' && {
      transport: { target: 'pino-pretty', options: { singleLine: true } },
    }),
  };
}
