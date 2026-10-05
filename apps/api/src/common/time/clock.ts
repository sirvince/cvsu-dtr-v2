import { Temporal } from '@js-temporal/polyfill';
import { LocalDate } from './local-date';
import { LocalTime } from './local-time';

/** ADR-16: every business date is an Asia/Manila date. */
export const BUSINESS_TIMEZONE = 'Asia/Manila';

/** Injection token for the Clock port. */
export const CLOCK = Symbol('CLOCK');

/**
 * The only source of "now" (ARCHITECTURE §9). Inject it instead of calling `new Date()`,
 * so tests can pin time with FixedClock.
 */
export interface Clock {
  readonly timeZone: string;
  now(): Temporal.Instant;
  /** Today's date in the business timezone. */
  today(): LocalDate;
  /** The current wall-clock time in the business timezone (minute precision). */
  timeOfDay(): LocalTime;
}

abstract class BaseClock implements Clock {
  constructor(readonly timeZone: string) {}

  abstract now(): Temporal.Instant;

  today(): LocalDate {
    return LocalDate.fromInstant(this.now(), this.timeZone);
  }

  timeOfDay(): LocalTime {
    const zoned = this.now().toZonedDateTimeISO(this.timeZone);
    return LocalTime.fromMinutes(zoned.hour * 60 + zoned.minute);
  }
}

export class SystemClock extends BaseClock {
  now(): Temporal.Instant {
    return Temporal.Now.instant();
  }
}

/** Test clock: starts at a fixed instant and only moves when told to. */
export class FixedClock extends BaseClock {
  private current: Temporal.Instant;

  constructor(instant: Temporal.Instant | string, timeZone: string = BUSINESS_TIMEZONE) {
    super(timeZone);
    this.current = typeof instant === 'string' ? Temporal.Instant.from(instant) : instant;
  }

  now(): Temporal.Instant {
    return this.current;
  }

  set(instant: Temporal.Instant | string): void {
    this.current = typeof instant === 'string' ? Temporal.Instant.from(instant) : instant;
  }

  /** Exact units only (hours, minutes, seconds…): an Instant has no calendar, so no days. */
  advance(duration: Temporal.DurationLike): void {
    this.current = this.current.add(duration);
  }
}
