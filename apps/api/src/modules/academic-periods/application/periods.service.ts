import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, type EntityManager, MoreThan } from 'typeorm';
import type { Actor, RequestContext } from '../../../common/actor';
import {
  DomainError,
  NotFoundError,
  ValidationFailedError,
} from '../../../common/domain/domain-error';
import { LocalDate } from '../../../common/time/local-date';
import { AuditService } from '../../audit/audit.service';
import type { CreateMonthDto, ListPeriodsQuery, PeriodView, UpdatePeriodDto } from '../api/dto';
import { halvesOf, isValidAdvanceDate, periodMachine } from '../domain/periods';
import { AcademicYearEntity, DtrPeriodEntity, SemesterEntity } from '../infrastructure/entities';

type DateLike = LocalDate | string;
const iso = (d: DateLike) => (typeof d === 'string' ? LocalDate.parse(d).toString() : d.toString());

/** 422 ADVANCE_DATE_OUT_OF_PERIOD (API-DESIGN §9). */
class AdvanceDateOutOfPeriodError extends DomainError {
  constructor(field: string, start: string, end: string) {
    super(
      'ADVANCE_DATE_OUT_OF_PERIOD',
      `The planned advance date must be from ${start} to before ${end}.`,
      {
        details: [{ field, message: `must satisfy ${start} ≤ date < ${end}` }],
      },
    );
  }
}

/**
 * Semi-monthly DTR periods (ADR-21, MODULES §4 academic-periods).
 * Public methods for other modules come first.
 */
@Injectable()
export class PeriodsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  // ── Public API ───────────────────────────────────────────────────────────────

  async get(id: string): Promise<PeriodView> {
    return toView(await this.load(this.dataSource.manager, id));
  }

  /** Throws 422 PERIOD_NOT_OPEN unless the period is OPEN. Returns it. */
  async assertOpen(id: string, tx: EntityManager = this.dataSource.manager): Promise<PeriodView> {
    const period = await this.load(tx, id);
    if (period.status !== 'OPEN') {
      throw new DomainError('PERIOD_NOT_OPEN', `${period.name} is ${period.status}, not OPEN.`, {
        details: { status: period.status },
      });
    }
    return toView(period);
  }

  /** The period containing `date`, or null. Periods never overlap (🔒), so there is at most one. */
  async periodContaining(date: DateLike): Promise<PeriodView | null> {
    const d = iso(date);
    const period = await this.dataSource
      .getRepository(DtrPeriodEntity)
      .createQueryBuilder('p')
      .where('p.startDate <= :d AND p.endDate >= :d', { d })
      .getOne();
    return period ? toView(period) : null;
  }

  /**
   * The first OPEN period starting after `periodId` ends. The carry-forward rule (ADR-25) adds the
   * "employee's DTR there is not finalized" condition on top, in the dtr module.
   */
  async nextOpenPeriodAfter(periodId: string): Promise<PeriodView | null> {
    const current = await this.load(this.dataSource.manager, periodId);
    const next = await this.dataSource.getRepository(DtrPeriodEntity).findOne({
      where: { startDate: MoreThan(current.endDate), status: 'OPEN' },
      order: { startDate: 'ASC' },
    });
    return next ? toView(next) : null;
  }

  async semesterOf(date: DateLike): Promise<SemesterEntity | null> {
    const d = iso(date);
    return this.dataSource
      .getRepository(SemesterEntity)
      .createQueryBuilder('s')
      .where('s.startDate <= :d AND s.endDate >= :d', { d })
      .orderBy('s.startDate', 'DESC')
      .getOne();
  }

  async academicYearOf(date: DateLike): Promise<AcademicYearEntity | null> {
    const d = iso(date);
    return this.dataSource
      .getRepository(AcademicYearEntity)
      .createQueryBuilder('y')
      .where('y.startDate <= :d AND y.endDate >= :d', { d })
      .getOne();
  }

  // ── Use cases (HTTP) ─────────────────────────────────────────────────────────

  async list(query: ListPeriodsQuery): Promise<PeriodView[]> {
    const qb = this.dataSource.getRepository(DtrPeriodEntity).createQueryBuilder('p');
    if (query.year) {
      qb.andWhere('p.startDate BETWEEN :from AND :to', {
        from: `${query.year}-01-01`,
        to: `${query.year}-12-31`,
      });
    }
    if (query.status) qb.andWhere('p.status = :status', { status: query.status });
    return (await qb.orderBy('p.startDate', 'ASC').getMany()).map(toView);
  }

  /**
   * Both halves in one transaction (API-DESIGN §5.4). If either overlaps an existing period,
   * nothing is created: 409 PERIOD_OVERLAP from the EXCLUDE constraint.
   * Phase 1 creates them OPEN; there is no separate open step (PHASE1-MVP §6).
   */
  async createMonth(dto: CreateMonthDto, actor: Actor, ctx: RequestContext): Promise<PeriodView[]> {
    const halves = halvesOf(dto.year, dto.month);
    const planned = [dto.plannedAdvanceDates?.first, dto.plannedAdvanceDates?.second];
    halves.forEach((half, i) => {
      const date = planned[i];
      if (date && !isValidAdvanceDate(LocalDate.parse(date), half.startDate, half.endDate)) {
        throw new AdvanceDateOutOfPeriodError(
          `plannedAdvanceDates.${i === 0 ? 'first' : 'second'}`,
          half.startDate.toString(),
          half.endDate.toString(),
        );
      }
    });
    if (
      dto.semesterId &&
      !(await this.dataSource.getRepository(SemesterEntity).existsBy({ id: dto.semesterId }))
    ) {
      throw new ValidationFailedError([{ field: 'semesterId', message: 'Unknown semester.' }]);
    }

    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(DtrPeriodEntity);
      const created: PeriodView[] = [];
      for (const [i, half] of halves.entries()) {
        const semesterId = dto.semesterId ?? (await this.semesterOf(half.startDate))?.id ?? null;
        const saved = await repo.save(
          repo.create({
            name: half.name,
            startDate: half.startDate.toString(),
            endDate: half.endDate.toString(),
            periodHalf: half.half,
            semesterId,
            plannedAdvanceDate: planned[i] ?? null,
            status: 'OPEN',
          }),
        );
        const view = toView(saved);
        await this.audit.record(tx, {
          ...ctx,
          actor,
          action: 'DTR_PERIOD_CREATED',
          entityType: 'dtr_period',
          entityId: saved.id,
          after: view,
        });
        created.push(view);
      }
      return created;
    });
  }

  async update(
    id: string,
    dto: UpdatePeriodDto,
    actor: Actor,
    ctx: RequestContext,
  ): Promise<PeriodView> {
    return this.dataSource.transaction(async (tx) => {
      const period = await this.load(tx, id, true);
      if (period.status === 'CLOSED') {
        throw new DomainError('PERIOD_NOT_OPEN', `${period.name} is closed.`, {
          details: { status: period.status },
        });
      }
      const before = toView(period);
      if (dto.plannedAdvanceDate !== undefined) {
        const date = dto.plannedAdvanceDate;
        if (
          date &&
          !isValidAdvanceDate(
            LocalDate.parse(date),
            LocalDate.parse(period.startDate),
            LocalDate.parse(period.endDate),
          )
        ) {
          throw new AdvanceDateOutOfPeriodError(
            'plannedAdvanceDate',
            period.startDate,
            period.endDate,
          );
        }
        period.plannedAdvanceDate = date;
      }
      if (dto.submissionDeadline !== undefined) period.submissionDeadline = dto.submissionDeadline;
      const after = toView(await tx.getRepository(DtrPeriodEntity).save(period));
      await this.audit.record(tx, {
        ...ctx,
        actor,
        action: 'DTR_PERIOD_UPDATED',
        entityType: 'dtr_period',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }

  /** OPEN → CLOSED. Closing an already closed period is a no-op (ADR-40). */
  async close(id: string, actor: Actor, ctx: RequestContext): Promise<PeriodView> {
    return this.dataSource.transaction(async (tx) => {
      const period = await this.load(tx, id, true);
      if (period.status === 'CLOSED') return toView(period);
      const from = period.status;
      period.status = periodMachine.transition(from, 'close', null);
      const view = toView(await tx.getRepository(DtrPeriodEntity).save(period));
      await this.audit.record(tx, {
        ...ctx,
        actor,
        action: 'DTR_PERIOD_CLOSED',
        entityType: 'dtr_period',
        entityId: id,
        before: { status: from },
        after: { status: period.status },
      });
      return view;
    });
  }

  private async load(tx: EntityManager, id: string, forUpdate = false): Promise<DtrPeriodEntity> {
    const period = await tx.getRepository(DtrPeriodEntity).findOne({
      where: { id },
      ...(forUpdate && { lock: { mode: 'pessimistic_write' as const } }),
    });
    if (!period) throw new NotFoundError('NOT_FOUND', 'DTR period not found.');
    return period;
  }
}

function toView(p: DtrPeriodEntity): PeriodView {
  return {
    id: p.id,
    name: p.name,
    startDate: p.startDate,
    endDate: p.endDate,
    periodHalf: p.periodHalf,
    semesterId: p.semesterId,
    plannedAdvanceDate: p.plannedAdvanceDate,
    submissionDeadline: p.submissionDeadline,
    status: p.status,
    advance: null,
  };
}
