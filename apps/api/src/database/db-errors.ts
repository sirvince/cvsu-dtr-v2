import type { ErrorCode } from '@cvsu-dtr/shared';
import { QueryFailedError } from 'typeorm';
import { ConflictError, type DomainError } from '../common/domain/domain-error';

// PostgreSQL SQLSTATE codes
const UNIQUE_VIOLATION = '23505';
const EXCLUSION_VIOLATION = '23P01';

/**
 * Named 🔒 constraints whose violation is a known business conflict. Add a row whenever a
 * migration adds a constraint that users can hit through normal use.
 */
const CONSTRAINT_ERRORS: Record<string, { code: ErrorCode; message: string }> = {
  ex_biometric_ids_no_overlap: {
    code: 'BIOMETRIC_MAPPING_OVERLAP',
    message: 'This biometric ID is already mapped to an employee for an overlapping date range.',
  },
  employees_employee_number_key: {
    code: 'EMPLOYEE_NUMBER_EXISTS',
    message: 'An employee with this employee number already exists.',
  },
  departments_code_key: {
    code: 'CONFLICT',
    message: 'A department with this code already exists.',
  },
};

interface PgDriverError {
  code?: string;
  constraint?: string;
}

/**
 * Turns a constraint violation into a 409 DomainError. Constraint names and SQL never reach
 * the client. Returns null for anything that isn't a known conflict (→ 500).
 */
export function translateDbError(error: unknown): DomainError | null {
  if (!(error instanceof QueryFailedError)) return null;
  const { code, constraint } = error.driverError as PgDriverError;

  const known = constraint ? CONSTRAINT_ERRORS[constraint] : undefined;
  if (known) return new ConflictError(known.code, known.message);

  if (code === UNIQUE_VIOLATION || code === EXCLUSION_VIOLATION) {
    return new ConflictError('CONFLICT', 'This conflicts with an existing record.');
  }
  return null;
}
