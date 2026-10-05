import { makeMachine, type Transition } from '../../../common/domain/state-machine';
import { LocalDate } from '../../../common/time/local-date';

export type PeriodHalf = 1 | 2;
export type PeriodStatus = 'DRAFT' | 'OPEN' | 'CLOSED';

export interface PeriodShape {
  half: PeriodHalf;
  name: string;
  startDate: LocalDate;
  endDate: LocalDate;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * ADR-21: every month has two DTR periods, days 1–15 and 16–end of month,
 * each printed on its own CSC Form 48. Names follow DATABASE-MAPPING §5: "Oct 2026 (1–15)".
 */
export function halvesOf(year: number, month: number): [PeriodShape, PeriodShape] {
  const first = LocalDate.of(year, month, 1);
  const lastDay = first.daysInMonth;
  const label = `${MONTHS[month - 1]} ${year}`;
  return [
    { half: 1, name: `${label} (1–15)`, startDate: first, endDate: LocalDate.of(year, month, 15) },
    {
      half: 2,
      name: `${label} (16–${lastDay})`,
      startDate: LocalDate.of(year, month, 16),
      endDate: LocalDate.of(year, month, lastDay),
    },
  ];
}

/** ADR-22: HR's planned advance date must leave at least the last day to be credited. */
export function isValidAdvanceDate(date: LocalDate, start: LocalDate, end: LocalDate): boolean {
  return !date.isBefore(start) && date.isBefore(end);
}

export type PeriodAction = 'open' | 'close' | 'reopen';

/**
 * BUSINESS-RULES §9 period lifecycle. Phase 1 creates periods OPEN and only closes them;
 * `reopen` (with a reason) is Phase 1B. Closing will also require every DTR to be finalized
 * (PERIOD_HAS_UNFINALIZED_DTRS) once DTRs exist (BE-024).
 */
const TRANSITIONS: Transition<PeriodStatus, PeriodAction, unknown>[] = [
  { action: 'open', from: ['DRAFT'], to: 'OPEN' },
  { action: 'close', from: ['OPEN'], to: 'CLOSED' },
  { action: 'reopen', from: ['CLOSED'], to: 'OPEN' },
];

export const periodMachine = makeMachine(TRANSITIONS, { invalidTransitionCode: 'PERIOD_NOT_OPEN' });
