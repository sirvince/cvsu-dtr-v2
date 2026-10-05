import { Temporal } from '@js-temporal/polyfill';
import { LocalDate } from './local-date';

describe('LocalDate', () => {
  it('parses strict YYYY-MM-DD', () => {
    const date = LocalDate.parse('2026-10-05');
    expect([date.year, date.month, date.day]).toEqual([2026, 10, 5]);
    expect(date.toString()).toBe('2026-10-05');
  });

  it.each(['2026-02-30', '2026-13-01', '2026-10-5', '10/05/2026', '2026-10-05T00:00', ''])(
    'rejects %p',
    (text) => {
      expect(() => LocalDate.parse(text)).toThrow(RangeError);
      expect(LocalDate.isValid(text)).toBe(false);
    },
  );

  it('knows weekdays and month lengths (semi-monthly periods end on day 15 or the last day)', () => {
    expect(LocalDate.parse('2026-10-05').dayOfWeek).toBe(1); // Monday
    expect(LocalDate.parse('2026-10-04').dayOfWeek).toBe(7); // Sunday
    expect(LocalDate.parse('2026-02-01').daysInMonth).toBe(28);
    expect(LocalDate.parse('2028-02-01').daysInMonth).toBe(29);
  });

  it('adds days across month and year ends', () => {
    expect(LocalDate.parse('2026-10-31').addDays(1).toString()).toBe('2026-11-01');
    expect(LocalDate.parse('2027-01-01').addDays(-1).toString()).toBe('2026-12-31');
    expect(LocalDate.parse('2026-09-01').daysUntil(LocalDate.parse('2026-09-15'))).toBe(14);
  });

  it('compares', () => {
    const a = LocalDate.parse('2026-09-15');
    const b = LocalDate.parse('2026-09-16');
    expect(a.isBefore(b)).toBe(true);
    expect(b.isAfter(a)).toBe(true);
    expect(a.compare(b)).toBe(-1);
    expect(a.equals(LocalDate.of(2026, 9, 15))).toBe(true);
  });

  it('takes the Manila date of an instant, not the UTC date', () => {
    // 2026-10-04T16:30Z is 00:30 on Oct 5 in Manila (UTC+8)
    const instant = Temporal.Instant.from('2026-10-04T16:30:00Z');
    expect(LocalDate.fromInstant(instant, 'Asia/Manila').toString()).toBe('2026-10-05');
    expect(LocalDate.fromInstant(instant, 'UTC').toString()).toBe('2026-10-04');
  });
});
