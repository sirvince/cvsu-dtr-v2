import { lockMinutesAfter } from './lockout';

describe('lockMinutesAfter', () => {
  it('does not lock before the 5th consecutive failure', () => {
    expect([1, 2, 3, 4].map(lockMinutesAfter)).toEqual([null, null, null, null]);
  });

  it('locks for 15 minutes at the 5th failure', () => {
    expect(lockMinutesAfter(5)).toBe(15);
  });

  it('is progressive: every further 5 failures doubles the lock, capped at 24 h', () => {
    expect([6, 9].map(lockMinutesAfter)).toEqual([null, null]);
    expect(lockMinutesAfter(10)).toBe(30);
    expect(lockMinutesAfter(15)).toBe(60);
    expect(lockMinutesAfter(50)).toBe(1440);
    expect(lockMinutesAfter(500)).toBe(1440);
  });
});
