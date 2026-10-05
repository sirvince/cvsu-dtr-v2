import { DomainError } from '../../../common/domain/domain-error';
import type { IsoWeekday, LocalDate } from '../../../common/time/local-date';
import { LocalTime } from '../../../common/time/local-time';

export interface BlockInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface Block {
  dayOfWeek: IsoWeekday;
  start: LocalTime;
  end: LocalTime;
}

export interface NumberedBlock extends Block {
  /** 1-based order within the day, by start time. */
  blockNo: number;
}

/** Default AM/PM split when a day has only one group (rule set `noon_boundary`, BUSINESS-RULES §5.1). */
export const DEFAULT_NOON_BOUNDARY = LocalTime.parse('12:00');

/**
 * ScheduleValidator (BUSINESS-RULES §6): ISO day 1–7, valid HH:mm, start < end (no midnight
 * crossing in Phase 1), and no overlap within a day. Adjacent blocks (07:00–10:00, 10:00–12:00)
 * are allowed. Returns the blocks numbered per day, sorted by day then start.
 */
export function validateBlocks(inputs: readonly BlockInput[]): NumberedBlock[] {
  if (inputs.length === 0) {
    throw new DomainError('SCHEDULE_INVALID_BLOCK', 'A schedule needs at least one block.', {
      details: [],
    });
  }

  const invalid: { index: number; message: string }[] = [];
  const blocks: Block[] = [];
  inputs.forEach((input, index) => {
    const day = input.dayOfWeek;
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      invalid.push({ index, message: 'dayOfWeek must be 1 (Monday) to 7 (Sunday).' });
      return;
    }
    if (!LocalTime.isValid(input.startTime) || !LocalTime.isValid(input.endTime)) {
      invalid.push({ index, message: 'startTime and endTime must be HH:mm.' });
      return;
    }
    const start = LocalTime.parse(input.startTime);
    const end = LocalTime.parse(input.endTime);
    if (!start.isBefore(end)) {
      invalid.push({
        index,
        message: `${input.startTime}–${input.endTime}: start must be before end.`,
      });
      return;
    }
    blocks.push({ dayOfWeek: day as IsoWeekday, start, end });
  });
  if (invalid.length) {
    throw new DomainError('SCHEDULE_INVALID_BLOCK', 'One or more schedule blocks are invalid.', {
      details: invalid,
    });
  }

  blocks.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.start.compare(b.start));
  const numbered: NumberedBlock[] = [];
  for (const [i, block] of blocks.entries()) {
    const previous = blocks[i - 1];
    if (previous && previous.dayOfWeek === block.dayOfWeek && block.start.isBefore(previous.end)) {
      throw new DomainError('SCHEDULE_OVERLAP', 'Two blocks on the same day overlap.', {
        details: {
          dayOfWeek: block.dayOfWeek,
          blocks: [
            `${previous.start.toString()}–${previous.end.toString()}`,
            `${block.start.toString()}–${block.end.toString()}`,
          ],
        },
      });
    }
    const blockNo =
      previous?.dayOfWeek === block.dayOfWeek ? (numbered[i - 1]?.blockNo ?? 0) + 1 : 1;
    numbered.push({ ...block, blockNo });
  }
  return numbered;
}

export interface Group {
  start: LocalTime;
  end: LocalTime;
}

export interface DaySchedule {
  blocks: Block[];
  /** Earliest start → latest end of the blocks starting before the default boundary. */
  am: Group | null;
  pm: Group | null;
  /** Midpoint between AM end and PM start when both exist, else the default boundary. */
  noonBoundary: LocalTime;
  /** Σ block minutes; the full-schedule credit of an advance day (D-HR-04). */
  scheduledMinutes: number;
}

/**
 * BUSINESS-RULES §4.2. Tardiness is measured from the group start, not from each block (ADR-32):
 * Mon 07:00–10:00, 10:00–12:00, 14:00–16:00, 16:00–19:00 → AM 07:00–12:00, PM 14:00–19:00,
 * boundary 13:00, 600 scheduled minutes.
 */
export function groupDay(
  dayBlocks: readonly Block[],
  defaultBoundary: LocalTime = DEFAULT_NOON_BOUNDARY,
): DaySchedule {
  const blocks = [...dayBlocks].sort((a, b) => a.start.compare(b.start));
  const amBlocks = blocks.filter((b) => b.start.isBefore(defaultBoundary));
  const pmBlocks = blocks.filter((b) => !b.start.isBefore(defaultBoundary));
  const am = span(amBlocks);
  const pm = span(pmBlocks);
  const noonBoundary =
    am && pm
      ? LocalTime.fromMinutes(
          Math.floor((am.end.minutesSinceMidnight + pm.start.minutesSinceMidnight) / 2),
        )
      : defaultBoundary;
  const scheduledMinutes = blocks.reduce((sum, b) => sum + b.start.minutesUntil(b.end), 0);
  return { blocks, am, pm, noonBoundary, scheduledMinutes };
}

function span(blocks: readonly Block[]): Group | null {
  if (blocks.length === 0) return null;
  let start = blocks[0]!.start;
  let end = blocks[0]!.end;
  for (const b of blocks) {
    if (b.start.isBefore(start)) start = b.start;
    if (b.end.isAfter(end)) end = b.end;
  }
  return { start, end };
}

export interface ExistingApproved {
  id: string;
  effectiveFrom: LocalDate;
  effectiveTo: LocalDate;
}

export type SupersedeStep =
  { id: string; action: 'TRIM'; effectiveTo: LocalDate } | { id: string; action: 'SUPERSEDE' };

/**
 * DATABASE-MAPPING §5 superseding: a new approved version from `newFrom` ends every approved
 * schedule overlapping [newFrom, newTo] the day before; one that would become empty is SUPERSEDED.
 */
export function planSupersede(
  existing: readonly ExistingApproved[],
  newFrom: LocalDate,
  newTo: LocalDate,
): SupersedeStep[] {
  return existing
    .filter((s) => !s.effectiveTo.isBefore(newFrom) && !s.effectiveFrom.isAfter(newTo))
    .map((s) =>
      s.effectiveFrom.isBefore(newFrom)
        ? { id: s.id, action: 'TRIM' as const, effectiveTo: newFrom.addDays(-1) }
        : { id: s.id, action: 'SUPERSEDE' as const },
    );
}

/** Two block lists describe the same week (order-insensitive). */
export function sameBlocks(a: readonly Block[], b: readonly Block[]): boolean {
  const key = (blocks: readonly Block[]) =>
    blocks
      .map((x) => `${x.dayOfWeek}@${x.start.toString()}-${x.end.toString()}`)
      .sort()
      .join(',');
  return key(a) === key(b);
}
