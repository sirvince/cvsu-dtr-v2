import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, type EntityManager, In, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import type { Actor, RequestContext } from '../../../common/actor';
import {
  ConflictError,
  DomainError,
  NotFoundError,
  ValidationFailedError,
} from '../../../common/domain/domain-error';
import { CLOCK, type Clock } from '../../../common/time/clock';
import { LocalDate } from '../../../common/time/local-date';
import { LocalTime } from '../../../common/time/local-time';
import { PeriodsService } from '../../academic-periods/application/periods.service';
import { AuditService } from '../../audit/audit.service';
import { EmployeesService } from '../../employees/application/employees.service';
import type {
  AssignResult,
  AssignScheduleDto,
  BlockView,
  CreateEmployeeScheduleDto,
  ReplaceBlocksDto,
  ScheduleView,
  TemplateView,
} from '../api/dto';
import {
  type Block,
  type BlockInput,
  type DaySchedule,
  DEFAULT_NOON_BOUNDARY,
  groupDay,
  type NumberedBlock,
  planSupersede,
  sameBlocks,
  validateBlocks,
} from '../domain/schedule';
import {
  EmployeeScheduleEntity,
  ScheduleBlockEntity,
  ScheduleTemplateEntity,
} from '../infrastructure/entities';

/** Seeded so HR can assign the standard office hours in one step (BE-007). */
export const DEFAULT_TEMPLATE = {
  name: 'Regular 8–5',
  blocks: [1, 2, 3, 4, 5].flatMap((dayOfWeek) => [
    { dayOfWeek, startTime: '08:00', endTime: '12:00' },
    { dayOfWeek, startTime: '13:00', endTime: '17:00' },
  ]),
};

export interface ApprovedDay extends DaySchedule {
  scheduleId: string;
  date: LocalDate;
}

interface Range {
  semesterId: string;
  from: LocalDate;
  to: LocalDate;
}

type DateLike = LocalDate | string;
const toDate = (d: DateLike) => (typeof d === 'string' ? LocalDate.parse(d) : d);
const hhmm = (t: string) => t.slice(0, 5);

/**
 * Schedules (BUSINESS-RULES §6). Phase 1 is HR-only: every schedule is created directly as
 * APPROVED (`approved_directly`, audited) outside the two-level workflow, which is Phase 1B (BE-037).
 */
@Injectable()
export class SchedulesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
    private readonly periods: PeriodsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ── Public API (BE-018, BE-019, BE-029) ──────────────────────────────────────

  /**
   * The employee's approved schedule on `date`, grouped into AM/PM (BUSINESS-RULES §4.2).
   * null = no approved schedule covers the date (→ NO_SCHEDULE). A covered date with no blocks
   * that weekday is a rest day: groups null, scheduledMinutes 0.
   */
  async approvedFor(
    employeeId: string,
    date: DateLike,
    noonBoundary: LocalTime = DEFAULT_NOON_BOUNDARY,
  ): Promise<ApprovedDay | null> {
    const day = toDate(date);
    const iso = day.toString();
    const schedule = await this.dataSource.getRepository(EmployeeScheduleEntity).findOne({
      where: {
        employeeId,
        status: 'APPROVED',
        effectiveFrom: LessThanOrEqual(iso),
        effectiveTo: MoreThanOrEqual(iso),
      },
    });
    if (!schedule) return null;
    const rows = await this.dataSource
      .getRepository(ScheduleBlockEntity)
      .findBy({ employeeScheduleId: schedule.id, dayOfWeek: day.dayOfWeek });
    return { scheduleId: schedule.id, date: day, ...groupDay(rows.map(toBlock), noonBoundary) };
  }

  // ── Templates ────────────────────────────────────────────────────────────────

  async listTemplates(): Promise<TemplateView[]> {
    const rows = await this.dataSource
      .getRepository(ScheduleTemplateEntity)
      .find({ where: { status: 'ACTIVE' }, order: { name: 'ASC' } });
    return rows.map(({ id, name, status, blocks }) => ({ id, name, status, blocks }));
  }

  /** Idempotent seed of "Regular 8–5". Returns its id. */
  async ensureDefaultTemplate(): Promise<string> {
    const repo = this.dataSource.getRepository(ScheduleTemplateEntity);
    await repo
      .createQueryBuilder()
      .insert()
      .values({ ...DEFAULT_TEMPLATE, status: 'ACTIVE' })
      .orIgnore()
      .execute();
    return (await repo.findOneByOrFail({ name: DEFAULT_TEMPLATE.name })).id;
  }

  // ── Use cases (HTTP) ─────────────────────────────────────────────────────────

  /**
   * POST /schedules/assign: one APPROVED schedule per employee from the template, superseding
   * what was there. All in one transaction. Inactive or unknown employees, and employees who
   * already have exactly this schedule, are reported in `skipped`.
   */
  async assign(dto: AssignScheduleDto, actor: Actor, ctx: RequestContext): Promise<AssignResult> {
    if (Boolean(dto.departmentId) === Boolean(dto.employeeIds?.length)) {
      throw new ValidationFailedError([
        { field: 'departmentId', message: 'Give exactly one of departmentId or employeeIds.' },
      ]);
    }
    const template = await this.dataSource
      .getRepository(ScheduleTemplateEntity)
      .findOneBy({ id: dto.templateId, status: 'ACTIVE' });
    if (!template) {
      throw new ValidationFailedError([
        { field: 'templateId', message: 'Unknown or inactive template.' },
      ]);
    }
    const blocks = validateBlocks(template.blocks);
    const range = await this.resolveRange(dto);

    const result: AssignResult = { created: 0, superseded: 0, scheduleIds: [], skipped: [] };
    let targets: string[];
    if (dto.departmentId) {
      targets = await this.employees.activeIdsInDepartment(dto.departmentId);
    } else {
      const ids = [...new Set(dto.employeeIds)];
      const statuses = await this.employees.statusesOf(ids);
      targets = [];
      for (const id of ids) {
        const found = statuses.get(id);
        if (!found) result.skipped.push({ employeeId: id, reason: 'NOT_FOUND' });
        else if (found.status !== 'ACTIVE')
          result.skipped.push({ employeeId: id, reason: 'INACTIVE' });
        else targets.push(id);
      }
    }

    await this.dataSource.transaction(async (tx) => {
      for (const employeeId of targets) {
        const outcome = await this.createApproved(tx, employeeId, range, blocks, actor, ctx, {
          action: 'SCHEDULE_ASSIGNED',
          templateId: template.id,
        });
        if (outcome === 'ALREADY_ASSIGNED') {
          result.skipped.push({ employeeId, reason: 'ALREADY_ASSIGNED' });
        } else {
          result.created += 1;
          result.superseded += outcome.superseded;
          result.scheduleIds.push(outcome.scheduleId);
        }
      }
    });
    return result;
  }

  /** POST /employees/:id/schedules: any number of blocks per day (ADR-32). */
  async createForEmployee(
    employeeId: string,
    dto: CreateEmployeeScheduleDto,
    actor: Actor,
    ctx: RequestContext,
  ): Promise<ScheduleView> {
    const employee = await this.employees.get(employeeId, actor); // 404 when unknown / out of scope
    if (employee.status !== 'ACTIVE') {
      throw new DomainError(
        'EMPLOYEE_INACTIVE',
        'Schedules can only be created for active employees.',
      );
    }
    const blocks = validateBlocks(dto.blocks);
    const range = await this.resolveRange(dto);

    const scheduleId = await this.dataSource.transaction(async (tx) => {
      const outcome = await this.createApproved(tx, employeeId, range, blocks, actor, ctx, {
        action: 'SCHEDULE_CREATED',
      });
      if (outcome === 'ALREADY_ASSIGNED') {
        throw new ConflictError(
          'SCHEDULE_OVERLAP',
          'The employee already has exactly this schedule for these dates.',
        );
      }
      return outcome.scheduleId;
    });
    return this.view(scheduleId);
  }

  /**
   * PUT …/schedules/:scheduleId: replace the blocks of an APPROVED schedule (If-Match: rowVersion).
   * Rejecting changes on dates of a FINALIZED DTR (SCHEDULE_LOCKED) is wired in BE-024.
   */
  async replaceBlocks(
    employeeId: string,
    scheduleId: string,
    dto: ReplaceBlocksDto,
    expectedRowVersion: number,
    actor: Actor,
    ctx: RequestContext,
  ): Promise<ScheduleView> {
    await this.employees.get(employeeId, actor);
    const blocks = validateBlocks(dto.blocks);

    await this.dataSource.transaction(async (tx) => {
      const schedule = await tx.getRepository(EmployeeScheduleEntity).findOne({
        where: { id: scheduleId, employeeId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!schedule) throw new NotFoundError('NOT_FOUND', 'Schedule not found.');
      if (schedule.rowVersion !== expectedRowVersion) {
        throw new ConflictError(
          'CONCURRENT_MODIFICATION',
          'The schedule was changed by someone else. Reload it.',
          {
            rowVersion: schedule.rowVersion,
          },
        );
      }
      if (schedule.status !== 'APPROVED') {
        throw new DomainError(
          'SCHEDULE_INVALID_TRANSITION',
          `A ${schedule.status} schedule can't be edited.`,
        );
      }

      const before = await this.blockViews(tx, scheduleId);
      await tx.getRepository(ScheduleBlockEntity).delete({ employeeScheduleId: scheduleId });
      await this.insertBlocks(tx, scheduleId, blocks);
      schedule.version += 1;
      await tx.getRepository(EmployeeScheduleEntity).save(schedule); // bumps row_version
      await this.audit.record(tx, {
        ...ctx,
        actor,
        action: 'SCHEDULE_BLOCKS_REPLACED',
        entityType: 'employee_schedule',
        entityId: scheduleId,
        before: { blocks: before },
        after: { blocks: blocks.map(toBlockView) },
        metadata: { employeeId, approval: 'DIRECT_HR' },
      });
    });
    return this.view(scheduleId);
  }

  async listForEmployee(employeeId: string, actor: Actor): Promise<ScheduleView[]> {
    await this.employees.get(employeeId, actor);
    const rows = await this.dataSource.getRepository(EmployeeScheduleEntity).find({
      where: { employeeId },
      order: { effectiveFrom: 'DESC', createdAt: 'DESC' },
    });
    return this.views(rows);
  }

  async get(scheduleId: string, actor: Actor): Promise<ScheduleView> {
    const schedule = await this.dataSource
      .getRepository(EmployeeScheduleEntity)
      .findOneBy({ id: scheduleId });
    if (!schedule) throw new NotFoundError('NOT_FOUND', 'Schedule not found.');
    await this.employees.get(schedule.employeeId, actor); // scope check
    return this.view(scheduleId);
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  /**
   * Supersede, then insert, in this order: the EXCLUDE constraint allows only one APPROVED
   * schedule per date, so the old ones must end first (DATABASE-MAPPING §5).
   */
  private async createApproved(
    tx: EntityManager,
    employeeId: string,
    range: Range,
    blocks: NumberedBlock[],
    actor: Actor,
    ctx: RequestContext,
    source: { action: 'SCHEDULE_ASSIGNED' | 'SCHEDULE_CREATED'; templateId?: string },
  ): Promise<{ scheduleId: string; superseded: number } | 'ALREADY_ASSIGNED'> {
    const schedules = tx.getRepository(EmployeeScheduleEntity);
    const overlapping = await schedules
      .createQueryBuilder('s')
      .setLock('pessimistic_write')
      .where('s.employeeId = :employeeId', { employeeId })
      .andWhere(`s.status = 'APPROVED'`)
      .andWhere('s.effectiveFrom <= :to AND s.effectiveTo >= :from', {
        from: range.from.toString(),
        to: range.to.toString(),
      })
      .getMany();

    for (const existing of overlapping) {
      if (
        existing.effectiveFrom === range.from.toString() &&
        existing.effectiveTo === range.to.toString()
      ) {
        const existingBlocks = (
          await tx.getRepository(ScheduleBlockEntity).findBy({ employeeScheduleId: existing.id })
        ).map(toBlock);
        if (sameBlocks(existingBlocks, blocks)) return 'ALREADY_ASSIGNED';
      }
    }

    const steps = planSupersede(
      overlapping.map((s) => ({
        id: s.id,
        effectiveFrom: LocalDate.parse(s.effectiveFrom),
        effectiveTo: LocalDate.parse(s.effectiveTo),
      })),
      range.from,
      range.to,
    );
    for (const step of steps) {
      const existing = overlapping.find((s) => s.id === step.id)!;
      const before = { status: existing.status, effectiveTo: existing.effectiveTo };
      if (step.action === 'TRIM') existing.effectiveTo = step.effectiveTo.toString();
      else existing.status = 'SUPERSEDED';
      await schedules.save(existing);
      await this.audit.record(tx, {
        ...ctx,
        actor,
        action: 'SCHEDULE_SUPERSEDED',
        entityType: 'employee_schedule',
        entityId: existing.id,
        before,
        after: { status: existing.status, effectiveTo: existing.effectiveTo },
        metadata: { employeeId, supersededFrom: range.from.toString() },
      });
    }

    const latest = await schedules.findOne({
      where: { employeeId, semesterId: range.semesterId },
      order: { version: 'DESC' },
    });
    const now = new Date(this.clock.now().epochMilliseconds);
    const saved = await schedules.save(
      schedules.create({
        employeeId,
        semesterId: range.semesterId,
        effectiveFrom: range.from.toString(),
        effectiveTo: range.to.toString(),
        status: 'APPROVED',
        version: (latest?.version ?? 0) + 1,
        approvedDirectly: true,
        submittedAt: null,
        reviewedBy: actor.userId,
        reviewedAt: now,
        reviewRemarks: null,
        createdBy: actor.userId,
      }),
    );
    await this.insertBlocks(tx, saved.id, blocks);
    await this.audit.record(tx, {
      ...ctx,
      actor,
      action: source.action,
      entityType: 'employee_schedule',
      entityId: saved.id,
      after: {
        employeeId,
        effectiveFrom: saved.effectiveFrom,
        effectiveTo: saved.effectiveTo,
        blocks: blocks.map(toBlockView),
      },
      metadata: {
        approval: 'DIRECT_HR',
        templateId: source.templateId ?? null,
        superseded: steps.map((s) => s.id),
      },
    });
    return { scheduleId: saved.id, superseded: steps.length };
  }

  /** The semester (given, or covering effectiveFrom); the range must lie inside it (§6). */
  private async resolveRange(dto: {
    semesterId?: string;
    effectiveFrom: string;
    effectiveTo: string;
  }): Promise<Range> {
    const from = LocalDate.parse(dto.effectiveFrom);
    const to = LocalDate.parse(dto.effectiveTo);
    if (to.isBefore(from)) {
      throw new ValidationFailedError([
        { field: 'effectiveTo', message: 'effectiveTo must not be before effectiveFrom.' },
      ]);
    }
    const semester = dto.semesterId
      ? await this.periods.getSemester(dto.semesterId)
      : await this.periods.semesterOf(from);
    if (!semester) {
      throw new ValidationFailedError([
        dto.semesterId
          ? { field: 'semesterId', message: 'Unknown semester.' }
          : {
              field: 'effectiveFrom',
              message: 'No semester covers this date. Create the semester first.',
            },
      ]);
    }
    if (
      from.isBefore(LocalDate.parse(semester.startDate)) ||
      to.isAfter(LocalDate.parse(semester.endDate))
    ) {
      throw new ValidationFailedError([
        {
          field: 'effectiveTo',
          message: `The schedule must fall within the semester (${semester.startDate} to ${semester.endDate}).`,
        },
      ]);
    }
    return { semesterId: semester.id, from, to };
  }

  private async insertBlocks(
    tx: EntityManager,
    scheduleId: string,
    blocks: NumberedBlock[],
  ): Promise<void> {
    const repo = tx.getRepository(ScheduleBlockEntity);
    await repo.insert(
      blocks.map((b) => ({
        employeeScheduleId: scheduleId,
        dayOfWeek: b.dayOfWeek,
        blockNo: b.blockNo,
        startTime: b.start.toString(),
        endTime: b.end.toString(),
      })),
    );
  }

  private async blockViews(tx: EntityManager, scheduleId: string): Promise<BlockView[]> {
    const rows = await tx.getRepository(ScheduleBlockEntity).find({
      where: { employeeScheduleId: scheduleId },
      order: { dayOfWeek: 'ASC', blockNo: 'ASC' },
    });
    return rows.map((r) => ({
      dayOfWeek: r.dayOfWeek,
      blockNo: r.blockNo,
      startTime: hhmm(r.startTime),
      endTime: hhmm(r.endTime),
    }));
  }

  private async view(scheduleId: string): Promise<ScheduleView> {
    const schedule = await this.dataSource
      .getRepository(EmployeeScheduleEntity)
      .findOneByOrFail({ id: scheduleId });
    return (await this.views([schedule]))[0]!;
  }

  private async views(schedules: EmployeeScheduleEntity[]): Promise<ScheduleView[]> {
    if (schedules.length === 0) return [];
    const blocks = await this.dataSource.getRepository(ScheduleBlockEntity).find({
      where: { employeeScheduleId: In(schedules.map((s) => s.id)) },
      order: { dayOfWeek: 'ASC', blockNo: 'ASC' },
    });
    return schedules.map((s) => ({
      id: s.id,
      employeeId: s.employeeId,
      semesterId: s.semesterId,
      effectiveFrom: s.effectiveFrom,
      effectiveTo: s.effectiveTo,
      status: s.status,
      version: s.version,
      rowVersion: s.rowVersion,
      approvedDirectly: s.approvedDirectly,
      createdBy: s.createdBy,
      createdAt: s.createdAt.toISOString(),
      blocks: blocks
        .filter((b) => b.employeeScheduleId === s.id)
        .map((b) => ({
          dayOfWeek: b.dayOfWeek,
          blockNo: b.blockNo,
          startTime: hhmm(b.startTime),
          endTime: hhmm(b.endTime),
        })),
    }));
  }
}

function toBlock(row: ScheduleBlockEntity | BlockInput): Block {
  return {
    dayOfWeek: row.dayOfWeek as Block['dayOfWeek'],
    start: LocalTime.parse(hhmm(row.startTime)),
    end: LocalTime.parse(hhmm(row.endTime)),
  };
}

function toBlockView(b: NumberedBlock): BlockView {
  return {
    dayOfWeek: b.dayOfWeek,
    blockNo: b.blockNo,
    startTime: b.start.toString(),
    endTime: b.end.toString(),
  };
}
