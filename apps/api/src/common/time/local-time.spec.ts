import { LocalTime } from './local-time';

describe('LocalTime', () => {
  it.each([
    ['00:00', 0],
    ['07:00', 420],
    ['12:30', 750],
    ['23:59', 1439],
  ])('parses %s as %i minutes', (text, minutes) => {
    const time = LocalTime.parse(text);
    expect(time.minutesSinceMidnight).toBe(minutes);
    expect(time.toString()).toBe(text);
  });

  it.each(['7:00', '24:00', '12:60', '12:00:00', '1200', '', ' 08:00', 'ab:cd'])(
    'rejects %p',
    (text) => {
      expect(() => LocalTime.parse(text)).toThrow(RangeError);
      expect(LocalTime.isValid(text)).toBe(false);
    },
  );

  it('compares and measures differences in minutes', () => {
    const start = LocalTime.parse('07:00');
    const late = LocalTime.parse('07:20');
    expect(start.minutesUntil(late)).toBe(20);
    expect(late.minutesUntil(start)).toBe(-20);
    expect(start.isBefore(late)).toBe(true);
    expect(late.isAfter(start)).toBe(true);
    expect(start.compare(late)).toBe(-1);
    expect(late.compare(start)).toBe(1);
    expect(start.equals(LocalTime.parse('07:00'))).toBe(true);
  });

  it('round-trips through minutes and JSON', () => {
    expect(LocalTime.fromMinutes(785).toString()).toBe('13:05');
    expect(JSON.stringify({ t: LocalTime.parse('13:05') })).toBe('{"t":"13:05"}');
    expect(() => LocalTime.fromMinutes(1440)).toThrow(RangeError);
    expect(() => LocalTime.fromMinutes(1.5)).toThrow(RangeError);
  });
});
