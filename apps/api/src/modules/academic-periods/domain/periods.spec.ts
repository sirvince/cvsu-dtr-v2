import { LocalDate } from '../../../common/time/local-date';
import { halvesOf, isValidAdvanceDate, periodMachine } from './periods';

const shape = (year: number, month: number) =>
  halvesOf(year, month).map((p) => ({
    half: p.half,
    name: p.name,
    start: p.startDate.toString(),
    end: p.endDate.toString(),
  }));

describe('halvesOf (ADR-21)', () => {
  it('October 2026: 1–15 and 16–31', () => {
    expect(shape(2026, 10)).toEqual([
      { half: 1, name: 'Oct 2026 (1–15)', start: '2026-10-01', end: '2026-10-15' },
      { half: 2, name: 'Oct 2026 (16–31)', start: '2026-10-16', end: '2026-10-31' },
    ]);
  });

  it('February: 16–28, and 16–29 in a leap year', () => {
    expect(shape(2027, 2)[1]).toMatchObject({ name: 'Feb 2027 (16–28)', end: '2027-02-28' });
    expect(shape(2028, 2)[1]).toMatchObject({ name: 'Feb 2028 (16–29)', end: '2028-02-29' });
  });

  it('30-day months end on the 30th', () => {
    expect(shape(2026, 11)[1]).toMatchObject({ end: '2026-11-30' });
  });
});

describe('isValidAdvanceDate', () => {
  const start = LocalDate.parse('2026-10-16');
  const end = LocalDate.parse('2026-10-31');
  it.each([
    ['2026-10-16', true],
    ['2026-10-28', true],
    ['2026-10-30', true],
    ['2026-10-31', false], // the last day must remain to be credited
    ['2026-10-15', false],
  ])('%s → %s', (date, ok) => {
    expect(isValidAdvanceDate(LocalDate.parse(date), start, end)).toBe(ok);
  });
});

describe('periodMachine', () => {
  it('opens, closes and reopens', () => {
    expect(periodMachine.transition('DRAFT', 'open', null)).toBe('OPEN');
    expect(periodMachine.transition('OPEN', 'close', null)).toBe('CLOSED');
    expect(periodMachine.transition('CLOSED', 'reopen', null)).toBe('OPEN');
  });

  it('refuses closing a period that is not open with PERIOD_NOT_OPEN', () => {
    expect(() => periodMachine.transition('DRAFT', 'close', null)).toThrow(
      expect.objectContaining({ code: 'PERIOD_NOT_OPEN' }),
    );
  });
});
