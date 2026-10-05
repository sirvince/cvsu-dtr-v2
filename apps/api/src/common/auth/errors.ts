import { DomainError } from '../domain/domain-error';

/** No or invalid access token. */
export class UnauthenticatedError extends DomainError {
  constructor() {
    super('UNAUTHENTICATED', 'Authentication is required.', { kind: 'UNAUTHENTICATED' });
  }
}

/** Expired access token, stale `ver`, or a revoked session: the client should refresh or log in. */
export class SessionExpiredError extends DomainError {
  constructor() {
    super('AUTH_TOKEN_EXPIRED', 'Your session has expired. Log in again.', {
      kind: 'UNAUTHENTICATED',
    });
  }
}

/** Authenticated, but the role lacks the capability (403). Out-of-scope data is a 404 instead. */
export class ForbiddenError extends DomainError {
  constructor() {
    super('FORBIDDEN', 'You do not have permission to do this.', { kind: 'FORBIDDEN' });
  }
}
