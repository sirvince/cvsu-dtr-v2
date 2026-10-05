import { BUSINESS_TIMEZONE, FixedClock, SystemClock } from './clock';

describe('FixedClock', () => {
  it('reports the business date and time in Manila', () => {
    const clock = new FixedClock('2026-10-04T23:15:00Z'); // 07:15 Oct 5 in Manila
    expect(clock.timeZone).toBe(BUSINESS_TIMEZONE);
    expect(clock.today().toString()).toBe('2026-10-05');
    expect(clock.timeOfDay().toString()).toBe('07:15');
  });

  it('only moves when told to', () => {
    const clock = new FixedClock('2026-10-05T15:59:00Z'); // 23:59 Manila
    expect(clock.now().toString()).toBe('2026-10-05T15:59:00Z');
    clock.advance({ minutes: 2 });
    expect(clock.today().toString()).toBe('2026-10-06');
    clock.set('2026-01-01T00:00:00Z');
    expect(clock.today().toString()).toBe('2026-01-01');
  });
});

describe('SystemClock', () => {
  it('returns the current instant', () => {
    const before = Date.now();
    const now = new SystemClock(BUSINESS_TIMEZONE).now().epochMilliseconds;
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
