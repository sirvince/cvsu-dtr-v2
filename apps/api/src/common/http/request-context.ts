import type { Request } from 'express';
import type { RequestContext } from '../actor';

/** Request metadata for audit rows. `req.ip` honours TRUST_PROXY (the client IP behind Nginx). */
export function requestContext(req: Request): RequestContext {
  return {
    requestId: typeof req.id === 'string' ? req.id : null,
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 500) ?? null,
  };
}
