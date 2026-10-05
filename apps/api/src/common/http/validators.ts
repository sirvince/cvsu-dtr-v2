import { registerDecorator, type ValidationOptions } from 'class-validator';
import { LocalDate } from '../time/local-date';
import { LocalTime } from '../time/local-time';

/** A real calendar date as `YYYY-MM-DD` (API-DESIGN §1). Rejects 2026-02-30. */
export function IsLocalDate(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isLocalDate',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: `${String(propertyName)} must be a date as YYYY-MM-DD`, ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && LocalDate.isValid(value),
      },
    });
}

/** A 24-hour time as `HH:mm` (API-DESIGN §1). */
export function IsLocalTime(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isLocalTime',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: `${String(propertyName)} must be a time as HH:mm`, ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && LocalTime.isValid(value),
      },
    });
}

/** Trims strings; leaves everything else for the other validators to reject. */
export const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Trims, and turns an empty optional string into null. */
export const trimToNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** `'%'` and `'_'` are wildcards in LIKE; escape them in user search text. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
