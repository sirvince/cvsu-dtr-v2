import { LocalDate } from '../../../common/time/local-date';
import { LocalTime } from '../../../common/time/local-time';
import { groupDay, planSupersede, sameBlocks, validateBlocks } from './schedule';

const monday = (...ranges: [string, string][]) =>
  ranges.map(([startTime, endTime]) => ({ dayOfWeek: 1, startTime, endTime }));
const fmt = (g: { start: LocalTime; end: LocalTime } | null) =>
  g ? `${g.start.toString()}–${g.end.toString()}` : null;

describe('validateBlocks (ScheduleValidator)', () => {
  it('accepts adjacent blocks and numbers them per day by start time', () => {
    const blocks = validateBlocks([
      { dayOfWeek: 1, startTime: '10:00', endTime: '12:00' },
      { dayOfWeek: 1, startTime: '07:00', endTime: '10:00' },
      { dayOfWeek: 2, startTime: '08:00', endTime: '12:00' },
    ]);
    expect(blocks.map((b) => [b.dayOfWeek, b.blockNo, b.start.toString()])).toEqual([
      [1, 1, '07:00'],
      [1, 2, '10:00'],
      [2, 1, '08:00'],
    ]);
  });

  it('rejects overlapping blocks on the same day with SCHEDULE_OVERLAP', () => {
    expect(() => validateBlocks(monday(['07:00', '10:00'], ['09:00', '11:00']))).toThrow(
      expect.objectContaining({
        code: 'SCHEDULE_OVERLAP',
        details: { dayOfWeek: 1, blocks: ['07:00–10:00', '09:00–11:00'] },
      }),
    );
  });

  it('allows the same times on different days', () => {
    expect(
      validateBlocks([
        { dayOfWeek: 1, startTime: '08:00', endTime: '12:00' },
        { dayOfWeek: 3, startTime: '08:00', endTime: '12:00' },
      ]),
    ).toHaveLength(2);
  });

  it.each([
    [{ dayOfWeek: 0, startTime: '08:00', endTime: '12:00' }, /dayOfWeek/],
    [{ dayOfWeek: 8, startTime: '08:00', endTime: '12:00' }, /dayOfWeek/],
    [{ dayOfWeek: 1, startTime: '8:00', endTime: '12:00' }, /HH:mm/],
    [{ dayOfWeek: 1, startTime: '12:00', endTime: '12:00' }, /start must be before end/],
    [{ dayOfWeek: 1, startTime: '22:00', endTime: '02:00' }, /start must be before end/], // midnight
  ])('rejects %o with SCHEDULE_INVALID_BLOCK', (block, message) => {
    expect(() => validateBlocks([block])).toThrow(
      expect.objectContaining({
        code: 'SCHEDULE_INVALID_BLOCK',
        details: [{ index: 0, message: expect.stringMatching(message) }],
      }),
    );
  });

  it('rejects an empty schedule', () => {
    expect(() => validateBlocks([])).toThrow(
      expect.objectContaining({ code: 'SCHEDULE_INVALID_BLOCK' }),
    );
  });
});

describe('groupDay (BUSINESS-RULES §4.2)', () => {
  const day = (...ranges: [string, string][]) => validateBlocks(monday(...ranges));

  it('faculty day with four entries: AM 07:00–12:00, PM 14:00–19:00, boundary 13:00, 600 min', () => {
    const g = groupDay(
      day(['07:00', '10:00'], ['10:00', '12:00'], ['14:00', '16:00'], ['16:00', '19:00']),
    );
    expect(fmt(g.am)).toBe('07:00–12:00');
    expect(fmt(g.pm)).toBe('14:00–19:00');
    expect(g.noonBoundary.toString()).toBe('13:00');
    expect(g.scheduledMinutes).toBe(600);
  });

  it('regular 8–5: boundary halfway through lunch, 480 min', () => {
    const g = groupDay(day(['08:00', '12:00'], ['13:00', '17:00']));
    expect(fmt(g.am)).toBe('08:00–12:00');
    expect(fmt(g.pm)).toBe('13:00–17:00');
    expect(g.noonBoundary.toString()).toBe('12:30');
    expect(g.scheduledMinutes).toBe(480);
  });

  it('a gap inside a group does not split it', () => {
    const g = groupDay(day(['07:00', '09:00'], ['10:00', '12:00']));
    expect(fmt(g.am)).toBe('07:00–12:00');
    expect(g.pm).toBeNull();
    expect(g.scheduledMinutes).toBe(240);
  });

  it('a PM-only day uses the default boundary', () => {
    const g = groupDay(day(['13:00', '17:00']));
    expect(g.am).toBeNull();
    expect(fmt(g.pm)).toBe('13:00–17:00');
    expect(g.noonBoundary.toString()).toBe('12:00');
  });

  it('honours a different rule-set boundary', () => {
    const g = groupDay(day(['11:00', '12:30']), LocalTime.parse('11:00'));
    expect(g.am).toBeNull();
    expect(fmt(g.pm)).toBe('11:00–12:30');
  });

  it('a day without blocks has nothing scheduled', () => {
    expect(groupDay([])).toMatchObject({ am: null, pm: null, scheduledMinutes: 0 });
  });
});

describe('planSupersede', () => {
  const d = (iso: string) => LocalDate.parse(iso);
  const existing = [
    { id: 'old', effectiveFrom: d('2026-08-11'), effectiveTo: d('2026-12-19') },
    { id: 'future', effectiveFrom: d('2026-11-01'), effectiveTo: d('2026-12-19') },
    { id: 'past', effectiveFrom: d('2026-01-05'), effectiveTo: d('2026-05-30') },
  ];

  it('trims a schedule that started earlier and supersedes one that would become empty', () => {
    expect(planSupersede(existing, d('2026-10-16'), d('2026-12-19'))).toEqual([
      { id: 'old', action: 'TRIM', effectiveTo: d('2026-10-15') },
      { id: 'future', action: 'SUPERSEDE' },
    ]);
  });

  it('a new version starting on the same day supersedes the old one entirely', () => {
    expect(planSupersede(existing.slice(0, 1), d('2026-08-11'), d('2026-12-19'))).toEqual([
      { id: 'old', action: 'SUPERSEDE' },
    ]);
  });

  it('leaves schedules outside the new range alone', () => {
    expect(planSupersede(existing.slice(2), d('2026-08-11'), d('2026-12-19'))).toEqual([]);
  });
});

describe('sameBlocks', () => {
  it('compares weeks regardless of order', () => {
    const a = validateBlocks(monday(['08:00', '12:00'], ['13:00', '17:00']));
    const b = validateBlocks(monday(['13:00', '17:00'], ['08:00', '12:00']));
    const c = validateBlocks(monday(['08:00', '12:00']));
    expect(sameBlocks(a, b)).toBe(true);
    expect(sameBlocks(a, c)).toBe(false);
  });
});
