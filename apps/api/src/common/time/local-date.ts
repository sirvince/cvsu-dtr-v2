import { Temporal } from '@js-temporal/polyfill';

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * A calendar date in the business timezone (work dates, period bounds, API `YYYY-MM-DD`).
 * Wraps Temporal.PlainDate, so date arithmetic has no timezone or DST surprises.
 */
export class LocalDate {
  private constructor(private readonly value: Temporal.PlainDate) {}

  /** Strict `YYYY-MM-DD` that must be a real calendar date. Throws RangeError otherwise. */
  static parse(value: string): LocalDate {
    if (!YYYY_MM_DD.test(value)) {
      throw new RangeError(`Invalid date "${value}", expected YYYY-MM-DD`);
    }
    // overflow: 'reject' turns 2026-02-30 into an error instead of clamping it to 2026-02-28
    return new LocalDate(Temporal.PlainDate.from(value, { overflow: 'reject' }));
  }

  static isValid(value: string): boolean {
    try {
      LocalDate.parse(value);
      return true;
    } catch {
      return false;
    }
  }

  static of(year: number, month: number, day: number): LocalDate {
    return new LocalDate(Temporal.PlainDate.from({ year, month, day }, { overflow: 'reject' }));
  }

  /** The calendar date of an instant as seen in `timeZone`. */
  static fromInstant(instant: Temporal.Instant, timeZone: string): LocalDate {
    return new LocalDate(instant.toZonedDateTimeISO(timeZone).toPlainDate());
  }

  get year(): number {
    return this.value.year;
  }

  get month(): number {
    return this.value.month;
  }

  get day(): number {
    return this.value.day;
  }

  get dayOfWeek(): IsoWeekday {
    return this.value.dayOfWeek as IsoWeekday;
  }

  get daysInMonth(): number {
    return this.value.daysInMonth;
  }

  addDays(days: number): LocalDate {
    return new LocalDate(this.value.add({ days }));
  }

  /** Signed whole days from `this` to `other` (positive when `other` is later). */
  daysUntil(other: LocalDate): number {
    return this.value.until(other.value, { largestUnit: 'days' }).days;
  }

  compare(other: LocalDate): -1 | 0 | 1 {
    return Temporal.PlainDate.compare(this.value, other.value);
  }

  isBefore(other: LocalDate): boolean {
    return this.compare(other) < 0;
  }

  isAfter(other: LocalDate): boolean {
    return this.compare(other) > 0;
  }

  equals(other: LocalDate): boolean {
    return this.value.equals(other.value);
  }

  toString(): string {
    return this.value.toString();
  }

  toJSON(): string {
    return this.toString();
  }
}
