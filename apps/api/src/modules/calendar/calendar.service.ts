import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Column, CreateDateColumn, type DataSource, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { Actor, RequestContext } from '../../common/actor';
import {
  type FieldError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/domain/domain-error';
import { LocalDate } from '../../common/time/local-date';
import { LocalTime } from '../../common/time/local-time';
import { AuditService } from '../audit/audit.service';
import {
  type CalendarEventType,
  type CalendarEventView,
  type CreateCalendarEventDto,
  type ListCalendarEventsQuery,
  WHOLE_DAY_TYPES,
} from './calendar.dto';

/** DATABASE-MAPPING §5. `time` columns come back as 'HH:mm:ss'. */
@Entity('calendar_events')
export class CalendarEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_date', type: 'date' })
  eventDate!: string;

  @Column({ type: 'text' })
  type!: CalendarEventType;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'start_time', type: 'time', nullable: true })
  startTime!: string | null;

  @Column({ name: 'end_time', type: 'time', nullable: true })
  endTime!: string | null;

  @Column({ type: 'text' })
  scope!: 'ALL' | 'DEPARTMENTS';

  @Column({ name: 'excuses_attendance', type: 'boolean' })
  excusesAttendance!: boolean;

  @Column({ type: 'text', nullable: true })
  reference!: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

type DateLike = LocalDate | string;
const iso = (d: DateLike) => (typeof d === 'string' ? LocalDate.parse(d).toString() : d.toString());

/**
 * Holidays, suspensions and government announcements (MODULES §4 calendar, ADR-27).
 * Phase 1 events apply to everyone (scope ALL); department-scoped events are Phase 1B.
 */
@Injectable()
export class CalendarService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  // ── Public API ───────────────────────────────────────────────────────────────

  /** Events affecting an employee of `departmentId` on `date` (scope ALL, or that department). */
  async eventsFor(date: DateLike, departmentId: string): Promise<CalendarEventView[]> {
    return this.eventsBetween(date, date, departmentId);
  }

  /** Same, for a range: one query for a whole period (processing, BE-019/029). */
  async eventsBetween(
    from: DateLike,
    to: DateLike,
    departmentId?: string,
  ): Promise<CalendarEventView[]> {
    const qb = this.dataSource
      .getRepository(CalendarEventEntity)
      .createQueryBuilder('c')
      .where('c.eventDate BETWEEN :from AND :to', { from: iso(from), to: iso(to) })
      .orderBy('c.eventDate')
      .addOrderBy('c.startTime', 'ASC', 'NULLS FIRST');
    if (departmentId) {
      qb.andWhere(
        `(c.scope = 'ALL' OR EXISTS (SELECT 1 FROM calendar_event_departments d
           WHERE d.calendar_event_id = c.id AND d.department_id = :departmentId))`,
        { departmentId },
      );
    } else {
      qb.andWhere(`c.scope = 'ALL'`);
    }
    return (await qb.getMany()).map(toView);
  }

  // ── Use cases (HTTP) ─────────────────────────────────────────────────────────

  async list(query: ListCalendarEventsQuery): Promise<CalendarEventView[]> {
    const qb = this.dataSource.getRepository(CalendarEventEntity).createQueryBuilder('c');
    if (query.from) qb.andWhere('c.eventDate >= :from', { from: query.from });
    if (query.to) qb.andWhere('c.eventDate <= :to', { to: query.to });
    if (query.type) qb.andWhere('c.type = :type', { type: query.type });
    return (
      await qb.orderBy('c.eventDate').addOrderBy('c.startTime', 'ASC', 'NULLS FIRST').getMany()
    ).map(toView);
  }

  async get(id: string): Promise<CalendarEventView> {
    const event = await this.dataSource.getRepository(CalendarEventEntity).findOneBy({ id });
    if (!event) throw new NotFoundError('NOT_FOUND', 'Calendar event not found.');
    return toView(event);
  }

  /**
   * A partial day is a start time ("suspended from 15:00"), optionally with an end time.
   * Holidays and special days are always whole days.
   * Marking the affected processed days stale arrives with processed_attendance (BE-019).
   */
  async create(
    dto: CreateCalendarEventDto,
    actor: Actor,
    ctx: RequestContext,
  ): Promise<CalendarEventView> {
    const problems = validateTimes(dto);
    if (problems.length) throw new ValidationFailedError(problems);

    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(CalendarEventEntity);
      const saved = await repo.save(
        repo.create({
          eventDate: dto.eventDate,
          type: dto.type,
          name: dto.name,
          startTime: dto.startTime ?? null,
          endTime: dto.endTime ?? null,
          scope: 'ALL',
          // A special working day is a normal working day (BUSINESS-RULES §5.6).
          excusesAttendance: dto.type !== 'SPECIAL_WORKING',
          reference: dto.reference ?? null,
          createdBy: actor.userId,
        }),
      );
      const view = toView(saved);
      await this.audit.record(tx, {
        ...ctx,
        actor,
        action: 'CALENDAR_EVENT_CREATED',
        entityType: 'calendar_event',
        entityId: saved.id,
        after: view,
      });
      return view;
    });
  }

  async remove(id: string, actor: Actor, ctx: RequestContext): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(CalendarEventEntity);
      const event = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!event) throw new NotFoundError('NOT_FOUND', 'Calendar event not found.');
      await tx.query(`DELETE FROM calendar_event_departments WHERE calendar_event_id = $1`, [id]);
      await repo.delete({ id });
      await this.audit.record(tx, {
        ...ctx,
        actor,
        action: 'CALENDAR_EVENT_DELETED',
        entityType: 'calendar_event',
        entityId: id,
        before: toView(event),
      });
    });
  }
}

function validateTimes(dto: CreateCalendarEventDto): FieldError[] {
  if (WHOLE_DAY_TYPES.includes(dto.type) && (dto.startTime || dto.endTime)) {
    return [
      { field: 'startTime', message: `${dto.type} is always a whole day; remove the times.` },
    ];
  }
  if (dto.endTime && !dto.startTime) {
    return [{ field: 'startTime', message: 'startTime is required when endTime is set.' }];
  }
  if (
    dto.startTime &&
    dto.endTime &&
    !LocalTime.parse(dto.startTime).isBefore(LocalTime.parse(dto.endTime))
  ) {
    return [{ field: 'endTime', message: 'endTime must be after startTime.' }];
  }
  return [];
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

function toView(c: CalendarEventEntity): CalendarEventView {
  return {
    id: c.id,
    eventDate: c.eventDate,
    type: c.type,
    name: c.name,
    startTime: hhmm(c.startTime),
    endTime: hhmm(c.endTime),
    scope: c.scope,
    excusesAttendance: c.excusesAttendance,
    reference: c.reference,
    createdAt: c.createdAt.toISOString(),
  };
}
