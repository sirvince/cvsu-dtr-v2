const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTES_PER_DAY = 24 * 60;

/**
 * A wall-clock time of day in the business timezone, with minute precision
 * (schedule blocks and DTR slots, API `HH:mm`). Stored as minutes since midnight,
 * so comparisons and differences never go through JS `Date`.
 */
export class LocalTime {
  private constructor(readonly minutesSinceMidnight: number) {}

  /** Strict `HH:mm`, 24-hour. Throws RangeError on anything else. */
  static parse(value: string): LocalTime {
    const m = HH_MM.exec(value);
    if (!m) throw new RangeError(`Invalid time "${value}", expected HH:mm`);
    return new LocalTime(Number(m[1]) * 60 + Number(m[2]));
  }

  static isValid(value: string): boolean {
    return HH_MM.test(value);
  }

  static fromMinutes(minutes: number): LocalTime {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes >= MINUTES_PER_DAY) {
      throw new RangeError(`Minutes out of range: ${minutes}`);
    }
    return new LocalTime(minutes);
  }

  get hour(): number {
    return Math.floor(this.minutesSinceMidnight / 60);
  }

  get minute(): number {
    return this.minutesSinceMidnight % 60;
  }

  /** Signed minutes from `this` to `other` (positive when `other` is later). */
  minutesUntil(other: LocalTime): number {
    return other.minutesSinceMidnight - this.minutesSinceMidnight;
  }

  compare(other: LocalTime): -1 | 0 | 1 {
    return Math.sign(this.minutesSinceMidnight - other.minutesSinceMidnight) as -1 | 0 | 1;
  }

  isBefore(other: LocalTime): boolean {
    return this.minutesSinceMidnight < other.minutesSinceMidnight;
  }

  isAfter(other: LocalTime): boolean {
    return this.minutesSinceMidnight > other.minutesSinceMidnight;
  }

  equals(other: LocalTime): boolean {
    return this.minutesSinceMidnight === other.minutesSinceMidnight;
  }

  toString(): string {
    return `${String(this.hour).padStart(2, '0')}:${String(this.minute).padStart(2, '0')}`;
  }

  toJSON(): string {
    return this.toString();
  }
}
