import { QueryFailedError } from 'typeorm';
import { translateDbError } from './db-errors';

const pgFailure = (driverError: Record<string, string>) =>
  new QueryFailedError('INSERT …', [], Object.assign(new Error('pg'), driverError));

describe('translateDbError', () => {
  it('maps the biometric EXCLUDE constraint to 409 BIOMETRIC_MAPPING_OVERLAP', () => {
    const error = translateDbError(
      pgFailure({ code: '23P01', constraint: 'ex_biometric_ids_no_overlap' }),
    );
    expect(error).toMatchObject({ code: 'BIOMETRIC_MAPPING_OVERLAP', kind: 'CONFLICT' });
  });

  it('maps an unknown unique or exclusion violation to a generic 409', () => {
    for (const code of ['23505', '23P01']) {
      expect(translateDbError(pgFailure({ code, constraint: 'something_else' }))).toMatchObject({
        code: 'CONFLICT',
        kind: 'CONFLICT',
      });
    }
  });

  it('never exposes the constraint name', () => {
    const error = translateDbError(
      pgFailure({ code: '23505', constraint: 'secret_internal_name' }),
    );
    expect(JSON.stringify(error)).not.toContain('secret_internal_name');
    expect(error?.message).not.toContain('secret_internal_name');
  });

  it('leaves everything else alone (→ 500)', () => {
    expect(translateDbError(pgFailure({ code: '23503' }))).toBeNull(); // FK violation
    expect(translateDbError(new Error('boom'))).toBeNull();
    expect(translateDbError(undefined)).toBeNull();
  });
});
