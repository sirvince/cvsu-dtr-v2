import type { FieldError } from '../../../common/domain/domain-error';

export const PASSWORD_MIN_LENGTH = 12;
/** Upper bound so a huge input can't be used to make argon2 burn CPU and memory. */
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordContext {
  email: string;
  /** Lowercased breached passwords (bundled list, SECURITY-PRIVACY §2). */
  breached: ReadonlySet<string>;
}

/**
 * SECURITY-PRIVACY §2: at least 12 characters and not a known breached password.
 * Length is counted in code points, so emoji and accented letters count as one each.
 * Returns field errors for `field`; an empty list means the password is acceptable.
 */
export function checkPassword(
  password: string,
  { email, breached }: PasswordContext,
  field = 'newPassword',
): FieldError[] {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) {
    return [{ field, message: `Use at least ${PASSWORD_MIN_LENGTH} characters.` }];
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return [{ field, message: `Use at most ${PASSWORD_MAX_LENGTH} characters.` }];
  }

  const errors: FieldError[] = [];
  const lowered = password.toLowerCase();
  if (breached.has(lowered)) {
    errors.push({
      field,
      message: 'This password appears in known data breaches. Choose another.',
    });
  }
  const localPart = email.split('@')[0]?.toLowerCase() ?? '';
  if (localPart.length >= 4 && lowered.includes(localPart)) {
    errors.push({ field, message: 'Do not include your email address in the password.' });
  }
  if (new Set(password).size === 1) {
    errors.push({ field, message: 'Do not repeat a single character.' });
  }
  return errors;
}
