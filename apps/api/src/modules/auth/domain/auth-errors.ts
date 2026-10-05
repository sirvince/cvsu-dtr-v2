import { DomainError } from '../../../common/domain/domain-error';

/** Same error for an unknown email and a wrong password, so accounts can't be enumerated. */
export class InvalidCredentialsError extends DomainError {
  constructor() {
    super('AUTH_INVALID_CREDENTIALS', 'The email or password is incorrect.', {
      kind: 'UNAUTHENTICATED',
    });
  }
}

export class AccountLockedError extends DomainError {
  constructor(lockedUntil: Date) {
    super('AUTH_ACCOUNT_LOCKED', 'Too many failed attempts. The account is temporarily locked.', {
      kind: 'UNAUTHENTICATED',
      details: { lockedUntil: lockedUntil.toISOString() },
    });
  }
}

export class RefreshReusedError extends DomainError {
  constructor() {
    super(
      'AUTH_REFRESH_REUSED',
      'This session was already used and has been ended. Log in again.',
      {
        kind: 'UNAUTHENTICATED',
      },
    );
  }
}
