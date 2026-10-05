import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { Actor, RequestContext } from '../../../common/actor';
import {
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from '../../../common/domain/domain-error';
import { LocalDate } from '../../../common/time/local-date';
import { AuditService } from '../../audit/audit.service';
import type {
  AcademicYearView,
  CreateAcademicYearDto,
  CreateSemesterDto,
  SemesterView,
} from '../api/dto';
import { AcademicYearEntity, SemesterEntity } from '../infrastructure/entities';

/** Academic years and semesters: the frame for schedules (BE-007), offset expiry and wellness. */
@Injectable()
export class AcademicYearsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<AcademicYearView[]> {
    const years = await this.dataSource
      .getRepository(AcademicYearEntity)
      .find({ order: { startDate: 'DESC' } });
    const semesters = await this.dataSource
      .getRepository(SemesterEntity)
      .find({ order: { startDate: 'ASC' } });
    return years.map((y) => ({
      ...y,
      semesters: semesters.filter((s) => s.academicYearId === y.id).map(toSemesterView),
    }));
  }

  async create(
    dto: CreateAcademicYearDto,
    actor: Actor,
    ctx: RequestContext,
  ): Promise<AcademicYearView> {
    assertRange(dto.startDate, dto.endDate);
    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(AcademicYearEntity);
      const saved = await repo.save(repo.create({ ...dto, status: 'ACTIVE' }));
      await this.audit.record(tx, {
        ...ctx,
        actor,
        action: 'ACADEMIC_YEAR_CREATED',
        entityType: 'academic_year',
        entityId: saved.id,
        after: dto,
      });
      return { ...saved, semesters: [] };
    });
  }

  /** A semester lies inside its academic year and doesn't overlap the year's other semesters. */
  async addSemester(
    academicYearId: string,
    dto: CreateSemesterDto,
    actor: Actor,
    ctx: RequestContext,
  ): Promise<SemesterView> {
    assertRange(dto.startDate, dto.endDate);
    return this.dataSource.transaction(async (tx) => {
      const year = await tx.getRepository(AcademicYearEntity).findOne({
        where: { id: academicYearId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!year) throw new NotFoundError('NOT_FOUND', 'Academic year not found.');
      if (dto.startDate < year.startDate || dto.endDate > year.endDate) {
        throw new ValidationFailedError([
          {
            field: 'startDate',
            message: `The semester must fall within ${year.startDate} to ${year.endDate}.`,
          },
        ]);
      }

      const repo = tx.getRepository(SemesterEntity);
      const siblings = await repo.findBy({ academicYearId });
      const clash = siblings.find((s) => dto.startDate <= s.endDate && s.startDate <= dto.endDate);
      if (clash) {
        throw new ConflictError('CONFLICT', `The dates overlap the ${clash.code} semester.`);
      }

      const saved = await repo.save(repo.create({ ...dto, academicYearId, status: 'ACTIVE' }));
      await this.audit.record(tx, {
        ...ctx,
        actor,
        action: 'SEMESTER_CREATED',
        entityType: 'semester',
        entityId: saved.id,
        after: { academicYearId, ...dto },
      });
      return toSemesterView(saved);
    });
  }
}

function assertRange(start: string, end: string): void {
  if (!LocalDate.parse(start).isBefore(LocalDate.parse(end))) {
    throw new ValidationFailedError([
      { field: 'endDate', message: 'endDate must be after startDate.' },
    ]);
  }
}

function toSemesterView(s: SemesterEntity): SemesterView {
  return {
    id: s.id,
    academicYearId: s.academicYearId,
    code: s.code,
    startDate: s.startDate,
    endDate: s.endDate,
    status: s.status,
  };
}
