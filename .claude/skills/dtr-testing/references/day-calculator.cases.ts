/**
 * BUSINESS-RULES.md §10 — Reference test cases, encoded as data.
 *
 * Copy to: apps/api/src/modules/attendance/domain/__tests__/day-calculator.cases.ts
 * HR signs off on this table before rule set v1 is published. If HR changes a value,
 * change BUSINESS-RULES.md §10 FIRST, then this file — never the other way round.
 *
 * Shared context (from §10):
 *   Rule set RS-TEST: FIXED, grace 0, FORGIVE_WITHIN, double-tap 2, lunch punch NOT required,
 *                     undertime = TARDY_PLUS_EARLY_OUT, half-day absence as ABSENCE.
 *   Schedule STD:     Mon–Fri, AM 08:00–12:00, PM 13:00–17:00 (noon boundary = 12:30).
 *   2026-10-05 is a Monday.
 */

export type Slot = 'AM_IN' | 'AM_OUT' | 'PM_IN' | 'PM_OUT';

export interface RuleOverrides {
  strategy?: 'FIXED' | 'FLEXI';
  grace_minutes?: number;
  grace_mode?: 'FORGIVE_WITHIN' | 'DEDUCT_GRACE';
  flexi?: { earliest_in: string; latest_in: string; required_minutes: number; break_minutes: number };
}

export interface CaseCalendarEvent {
  type: 'REGULAR_HOLIDAY' | 'SPECIAL_NON_WORKING' | 'SPECIAL_WORKING' | 'WORK_SUSPENSION' | 'CAMPUS_EVENT';
  startTime?: string; // suspension from …
}

export interface CaseException {
  type: 'LEAVE' | 'OFFICIAL_BUSINESS' | 'OFFICIAL_TIME' | 'TIME_CORRECTION' | 'MISSING_PUNCH_CERTIFICATION';
  subtype?: string;
  scope: 'WHOLE_DAY' | 'AM' | 'PM' | 'SLOT' | 'TIME_RANGE';
  slot?: Slot;
  timeValue?: string;
}

export interface DayCase {
  id: string;
  title: string;
  date: string;                      // YYYY-MM-DD (Asia/Manila business date)
  punches: string[];                 // 'HH:mm' local times, in the order the device exported them
  schedule: 'STD' | null;            // null = no APPROVED schedule on this date
  calendar?: CaseCalendarEvent[];
  exceptions?: CaseException[];      // APPROVED only
  rules?: RuleOverrides;             // merged over RS-TEST
  expect: {
    amIn?: string | null;
    amOut?: string | null;
    pmIn?: string | null;
    pmOut?: string | null;
    tardy?: number;                  // omitted = not asserted (e.g. "—" in the doc)
    earlyOut?: number;
    undertime?: number;
    worked?: number;
    status?: string;
    flags?: string[];                // must be contained in result.flags
    isBlocking?: boolean;
    ignoredPunches?: string[];       // 'HH:mm' of punches that must NOT be used
    slotSources?: Partial<Record<'amIn' | 'amOut' | 'pmIn' | 'pmOut', 'PUNCH' | 'CORRECTION' | 'CERTIFICATION'>>;
  };
}

const MON = '2026-10-05';
const WED = '2026-10-07';
const SAT = '2026-10-10';

export const FIXED_CASES: DayCase[] = [
  { id: 'T01', title: 'Normal', date: MON, schedule: 'STD',
    punches: ['07:52', '12:01', '12:58', '17:03'],
    expect: { amIn: '07:52', amOut: '12:01', pmIn: '12:58', pmOut: '17:03', tardy: 0, earlyOut: 0, undertime: 0, worked: 480, status: 'PRESENT', isBlocking: false } },

  { id: 'T02', title: 'Late AM', date: MON, schedule: 'STD',
    punches: ['08:15', '12:00', '13:00', '17:00'],
    expect: { amIn: '08:15', amOut: '12:00', pmIn: '13:00', pmOut: '17:00', tardy: 15, earlyOut: 0, undertime: 15, worked: 465, status: 'LATE' } },

  { id: 'T03', title: 'No lunch punches', date: MON, schedule: 'STD',
    punches: ['07:55', '17:10'],
    expect: { amIn: '07:55', amOut: null, pmIn: null, pmOut: '17:10', tardy: 0, earlyOut: 0, undertime: 0, worked: 480, status: 'PRESENT', isBlocking: false } },

  { id: 'T04', title: 'Late PM + early out', date: MON, schedule: 'STD',
    punches: ['07:58', '12:00', '13:20', '16:30'],
    expect: { amIn: '07:58', amOut: '12:00', pmIn: '13:20', pmOut: '16:30', tardy: 20, earlyOut: 30, undertime: 50, worked: 430, status: 'LATE_UNDERTIME' } },

  { id: 'T05', title: 'Double tap', date: MON, schedule: 'STD',
    punches: ['07:50', '07:51', '12:05', '13:00', '17:00'],
    expect: { amIn: '07:50', amOut: '12:05', pmIn: '13:00', pmOut: '17:00', tardy: 0, earlyOut: 0, undertime: 0, worked: 480, status: 'PRESENT', ignoredPunches: ['07:51'] } },

  { id: 'T06', title: 'AM absent', date: MON, schedule: 'STD',
    punches: ['13:05', '17:00'],
    expect: { amIn: null, amOut: null, pmIn: '13:05', pmOut: '17:00', tardy: 5, earlyOut: 0, undertime: 5, worked: 235, status: 'HALF_DAY_ABSENT' } },

  { id: 'T07', title: 'PM absent', date: MON, schedule: 'STD',
    punches: ['08:00', '12:00'],
    expect: { amIn: '08:00', amOut: '12:00', pmIn: null, pmOut: null, tardy: 0, earlyOut: 0, undertime: 0, worked: 240, status: 'HALF_DAY_ABSENT' } },

  { id: 'T08', title: 'No punches, Wednesday', date: WED, schedule: 'STD',
    punches: [],
    expect: { amIn: null, amOut: null, pmIn: null, pmOut: null, tardy: 0, earlyOut: 0, undertime: 0, worked: 0, status: 'ABSENT' } },

  { id: 'T09', title: 'No punches, regular holiday', date: MON, schedule: 'STD',
    calendar: [{ type: 'REGULAR_HOLIDAY' }],
    punches: [],
    expect: { tardy: 0, earlyOut: 0, undertime: 0, worked: 0, status: 'HOLIDAY', isBlocking: false } },

  { id: 'T10', title: 'Single punch', date: MON, schedule: 'STD',
    punches: ['08:10'],
    expect: { amIn: '08:10', amOut: null, pmIn: null, pmOut: null, tardy: 10, earlyOut: 0, undertime: 10, worked: 0, status: 'INCOMPLETE', flags: ['MISSING_PM_OUT'], isBlocking: true } },

  { id: 'T11', title: 'Whole-day OB (approved)', date: MON, schedule: 'STD',
    exceptions: [{ type: 'OFFICIAL_BUSINESS', scope: 'WHOLE_DAY' }],
    punches: [],
    expect: { tardy: 0, earlyOut: 0, undertime: 0, worked: 0, status: 'OFFICIAL_BUSINESS', isBlocking: false } },

  { id: 'T12', title: 'Suspension from 15:00', date: MON, schedule: 'STD',
    calendar: [{ type: 'WORK_SUSPENSION', startTime: '15:00' }],
    punches: ['08:00', '12:00', '13:00', '15:05'],
    expect: { amIn: '08:00', amOut: '12:00', pmIn: '13:00', pmOut: '15:05', tardy: 0, earlyOut: 0, undertime: 0, worked: 360, status: 'PRESENT', flags: ['PARTIAL_SUSPENSION'] } },

  { id: 'T13', title: 'Saturday', date: SAT, schedule: 'STD',
    punches: ['09:00', '12:00'],
    expect: { tardy: 0, earlyOut: 0, undertime: 0, worked: 0, status: 'REST_DAY', isBlocking: false } },

  { id: 'T14', title: 'Half-day VL (AM)', date: MON, schedule: 'STD',
    exceptions: [{ type: 'LEAVE', subtype: 'VL', scope: 'AM' }],
    punches: ['13:00', '17:00'],
    expect: { amIn: null, amOut: null, pmIn: '13:00', pmOut: '17:00', tardy: 0, earlyOut: 0, undertime: 0, worked: 240, status: 'PRESENT', flags: ['HALF_DAY_LEAVE_AM'] } },

  { id: 'T15', title: 'TIME_CORRECTION AM_IN = 08:00 (raw 08:17 kept)', date: MON, schedule: 'STD',
    exceptions: [{ type: 'TIME_CORRECTION', scope: 'SLOT', slot: 'AM_IN', timeValue: '08:00' }],
    punches: ['08:17', '12:00', '13:00', '17:00'],
    expect: { amIn: '08:00', amOut: '12:00', pmIn: '13:00', pmOut: '17:00', tardy: 0, earlyOut: 0, undertime: 0, worked: 480, status: 'PRESENT', slotSources: { amIn: 'CORRECTION' } } },

  { id: 'T16', title: 'No approved schedule', date: MON, schedule: null,
    punches: ['08:00', '17:00'],
    expect: { status: 'NO_SCHEDULE', isBlocking: true } },
];

/** Grace variants (T02-style punches, AM start 08:00). Only tardiness is asserted. */
export const GRACE_CASES: DayCase[] = [
  { id: 'G01', title: 'grace 5, FORGIVE_WITHIN, 08:05', date: MON, schedule: 'STD',
    rules: { grace_minutes: 5, grace_mode: 'FORGIVE_WITHIN' },
    punches: ['08:05', '12:00', '13:00', '17:00'], expect: { amIn: '08:05', tardy: 0 } },
  { id: 'G02', title: 'grace 5, FORGIVE_WITHIN, 08:06', date: MON, schedule: 'STD',
    rules: { grace_minutes: 5, grace_mode: 'FORGIVE_WITHIN' },
    punches: ['08:06', '12:00', '13:00', '17:00'], expect: { amIn: '08:06', tardy: 6 } },
  { id: 'G03', title: 'grace 5, DEDUCT_GRACE, 08:06', date: MON, schedule: 'STD',
    rules: { grace_minutes: 5, grace_mode: 'DEDUCT_GRACE' },
    punches: ['08:06', '12:00', '13:00', '17:00'], expect: { amIn: '08:06', tardy: 1 } },
];

const FLEXI = { strategy: 'FLEXI' as const,
  flexi: { earliest_in: '07:00', latest_in: '09:00', required_minutes: 480, break_minutes: 60 } };

/** FLEXI (window 07:00–09:00, 480 + 60 break). */
export const FLEXI_CASES: DayCase[] = [
  { id: 'X01', title: 'Flexi 07:30–16:30', date: MON, schedule: 'STD', rules: FLEXI,
    punches: ['07:30', '16:30'], expect: { tardy: 0, earlyOut: 0, worked: 480 } },
  { id: 'X02', title: 'Flexi 08:45–17:00', date: MON, schedule: 'STD', rules: FLEXI,
    punches: ['08:45', '17:00'], expect: { tardy: 0, earlyOut: 45, worked: 435 } },
  { id: 'X03', title: 'Flexi 09:10–18:10', date: MON, schedule: 'STD', rules: FLEXI,
    punches: ['09:10', '18:10'], expect: { tardy: 10, earlyOut: 0, worked: 480 } },
];

/** Phase 1 must-pass set (PHASE1-MVP-1-MONTH.md §7). Add T11/T14 when day remarks are built. */
export const PHASE1_REQUIRED = ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'T13', 'T16'];
