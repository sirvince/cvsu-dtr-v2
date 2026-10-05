import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, type DataSource, type EntityManager, In } from 'typeorm';
import type { Actor, RequestContext } from '../../../common/actor';
import { ScopePolicy } from '../../../common/auth/scope-policy';
import {
  type FieldError,
  NotFoundError,
  ValidationFailedError,
} from '../../../common/domain/domain-error';
import { Paginated } from '../../../common/http/paginated';
import { likePattern } from '../../../common/http/validators';
import { LocalDate } from '../../../common/time/local-date';
import { AuditService } from '../../audit/audit.service';
import { DepartmentsService } from '../../departments/departments.service';
import { DevicesService } from '../../devices/devices.module';
import type {
  BiometricIdView,
  CreateBiometricIdDto,
  CreateEmployeeDto,
  DeactivateEmployeeDto,
  EmployeeView,
  EndBiometricIdDto,
  ListEmployeesQuery,
  UpdateEmployeeDto,
} from '../api/dto';
import { EmployeeBiometricIdEntity, EmployeeEntity } from '../infrastructure/entities';

const SORT_COLUMNS: Record<ListEmployeesQuery['sort'], string[]> = {
  lastName: ['e.lastName', 'e.firstName'],
  employeeNumber: ['e.employeeNumber'],
  createdAt: ['e.createdAt'],
};

/** A date or 'YYYY-MM-DD'. */
type DateLike = LocalDate | string;
const iso = (d: DateLike): string =>
  typeof d === 'string' ? LocalDate.parse(d).toString() : d.toString();

/**
 * Employee master data and the dated biometric ID mapping (MODULES §4 employees).
 * Other modules use only the public methods at the top: never the entities or repositories.
 */
@Injectable()
export class EmployeesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly scope: ScopePolicy,
    private readonly departments: DepartmentsService,
    private readonly devices: DevicesService,
  ) {}

  // ── Public API for other modules ─────────────────────────────────────────────

  /**
   * Which employee a device enrolment number belonged to on `date` (ADR-03: matching happens at
   * processing time, not at import). Mapping ranges are inclusive on both ends. null = unmatched.
   */
  async resolveByBiometric(
    deviceId: string,
    biometricIdentifier: string,
    date: DateLike,
  ): Promise<string | null> {
    const row = await this.dataSource
      .getRepository(EmployeeBiometricIdEntity)
      .createQueryBuilder('m')
      .select('m.employeeId', 'employeeId')
      .where('m.deviceId = :deviceId', { deviceId })
      .andWhere('m.biometricIdentifier = :biometricIdentifier', { biometricIdentifier })
      .andWhere('m.validFrom <= :date', { date: iso(date) })
      .andWhere('(m.validTo IS NULL OR m.validTo >= :date)')
      .getRawOne<{ employeeId: string }>();
    return row?.employeeId ?? null;
  }

  /**
   * Employees who were employed at any point in [from, to]: ACTIVE ones, plus INACTIVE ones whose
   * separation date falls inside or after the range (they still get a DTR for the days they worked).
   * Hire and separation dates bound the range when present.
   */
  async listActive(
    range: { from: DateLike; to: DateLike },
    departmentId?: string,
  ): Promise<EmployeeView[]> {
    const from = iso(range.from);
    const to = iso(range.to);
    const qb = this.dataSource
      .getRepository(EmployeeEntity)
      .createQueryBuilder('e')
      .where(`(e.status = 'ACTIVE' OR e.separatedOn >= :from)`, { from })
      .andWhere('(e.hiredOn IS NULL OR e.hiredOn <= :to)', { to })
      .andWhere('(e.separatedOn IS NULL OR e.separatedOn >= :from)')
      .orderBy('e.lastName')
      .addOrderBy('e.firstName')
      .addOrderBy('e.id');
    if (departmentId) qb.andWhere('e.departmentId = :departmentId', { departmentId });
    return (await qb.getMany()).map(toView);
  }

  /** Status and department of each id that exists (unknown ids are simply absent). */
  async statusesOf(
    employeeIds: readonly string[],
  ): Promise<Map<string, { status: 'ACTIVE' | 'INACTIVE'; departmentId: string }>> {
    if (employeeIds.length === 0) return new Map();
    const rows = await this.dataSource.getRepository(EmployeeEntity).find({
      where: { id: In([...employeeIds]) },
      select: { id: true, status: true, departmentId: true },
    });
    return new Map(rows.map((r) => [r.id, { status: r.status, departmentId: r.departmentId }]));
  }

  /** ACTIVE employees of a department, as of now. */
  async activeIdsInDepartment(departmentId: string): Promise<string[]> {
    const rows = await this.dataSource.getRepository(EmployeeEntity).find({
      where: { departmentId, status: 'ACTIVE' },
      select: { id: true },
      order: { lastName: 'ASC', firstName: 'ASC' },
    });
    return rows.map((r) => r.id);
  }

  async departmentOf(employeeId: string): Promise<string | null> {
    const employee = await this.dataSource
      .getRepository(EmployeeEntity)
      .findOne({ where: { id: employeeId }, select: { departmentId: true } });
    return employee?.departmentId ?? null;
  }

  // ── Use cases (HTTP) ─────────────────────────────────────────────────────────

  async list(query: ListEmployeesQuery, actor: Actor): Promise<Paginated<EmployeeView>> {
    const departments = this.scope.departmentFilter(actor);
    if (departments !== 'ALL' && departments.length === 0) {
      return new Paginated([], 0, query.page, query.limit);
    }

    const qb = this.dataSource.getRepository(EmployeeEntity).createQueryBuilder('e');
    // Scope is filtered in SQL, never in memory (dtr-security skill).
    if (departments !== 'ALL') qb.andWhere('e.departmentId = ANY(:departments)', { departments });
    if (query.departmentId)
      qb.andWhere('e.departmentId = :departmentId', { departmentId: query.departmentId });
    if (query.status) qb.andWhere('e.status = :status', { status: query.status });
    if (query.q) {
      const q = likePattern(query.q);
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('e.lastName ILIKE :q', { q })
            .orWhere('e.firstName ILIKE :q')
            .orWhere('e.employeeNumber ILIKE :q')
            .orWhere(`(e.firstName || ' ' || e.lastName) ILIKE :q`),
        ),
      );
    }
    const direction = query.order === 'desc' ? 'DESC' : 'ASC';
    for (const column of SORT_COLUMNS[query.sort]) qb.addOrderBy(column, direction);
    qb.addOrderBy('e.id', 'ASC'); // stable pages

    const [rows, total] = await qb
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return new Paginated(rows.map(toView), total, query.page, query.limit);
  }

  async get(id: string, actor: Actor): Promise<EmployeeView> {
    return toView(await this.loadInScope(this.dataSource.manager, id, actor));
  }

  async create(dto: CreateEmployeeDto, actor: Actor, ctx: RequestContext): Promise<EmployeeView> {
    await this.assertDepartmentActive(dto.departmentId);
    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(EmployeeEntity);
      // A duplicate employee_number fails on the unique key → 409 EMPLOYEE_NUMBER_EXISTS.
      const saved = await repo.save(
        repo.create({
          employeeNumber: dto.employeeNumber,
          firstName: dto.firstName,
          middleName: dto.middleName ?? null,
          lastName: dto.lastName,
          suffix: dto.suffix ?? null,
          email: dto.email ?? null,
          departmentId: dto.departmentId,
          positionTitle: dto.positionTitle ?? null,
          category: dto.category,
          employmentType: dto.employmentType,
          status: 'ACTIVE',
          hiredOn: dto.hiredOn ?? null,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        }),
      );
      const view = toView(saved);
      await this.audit.record(tx, {
        ...ctx,
        actor,
        action: 'EMPLOYEE_CREATED',
        entityType: 'employee',
        entityId: saved.id,
        after: view,
      });
      return view;
    });
  }

  async update(
    id: string,
    dto: UpdateEmployeeDto,
    actor: Actor,
    ctx: RequestContext,
  ): Promise<EmployeeView> {
    return this.dataSource.transaction(async (tx) => {
      const employee = await this.loadInScope(tx, id, actor, true);
      if (dto.departmentId && dto.departmentId !== employee.departmentId) {
        await this.assertDepartmentActive(dto.departmentId);
      }
      const before = toView(employee);
      for (const key of Object.keys(dto) as (keyof UpdateEmployeeDto)[]) {
        if (dto[key] !== undefined) Object.assign(employee, { [key]: dto[key] });
      }
      assertDatesInOrder(employee.hiredOn, employee.separatedOn, 'hiredOn');
      employee.updatedBy = actor.userId;
      const after = toView(await tx.getRepository(EmployeeEntity).save(employee));
      await this.audit.record(tx, {
        ...ctx,
        actor,
        action: 'EMPLOYEE_UPDATED',
        entityType: 'employee',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }

  /**
   * Employees are deactivated, never deleted (DATABASE-MAPPING §1). With a separation date, open
   * biometric mappings end on that date, so the enrolment number can be reassigned later.
   */
  async deactivate(
    id: string,
    dto: DeactivateEmployeeDto,
    actor: Actor,
    ctx: RequestContext,
  ): Promise<EmployeeView> {
    return this.dataSource.transaction(async (tx) => {
      const employee = await this.loadInScope(tx, id, actor, true);
      if (employee.status === 'INACTIVE') return toView(employee);
      const before = toView(employee);

      employee.status = 'INACTIVE';
      if (dto.separatedOn) employee.separatedOn = dto.separatedOn;
      assertDatesInOrder(employee.hiredOn, employee.separatedOn, 'separatedOn');
      employee.updatedBy = actor.userId;
      const after = toView(await tx.getRepository(EmployeeEntity).save(employee));

      let endedMappings: string[] = [];
      if (employee.separatedOn) {
        const result = await tx
          .createQueryBuilder()
          .update(EmployeeBiometricIdEntity)
          .set({ validTo: employee.separatedOn })
          .where('employee_id = :id', { id })
          .andWhere('valid_from <= :end', { end: employee.separatedOn })
          .andWhere('(valid_to IS NULL OR valid_to > :end)')
          .returning(['id'])
          .execute();
        endedMappings = (result.raw as { id: string }[]).map((r) => r.id);
      }

      await this.audit.record(tx, {
        ...ctx,
        actor,
        action: 'EMPLOYEE_DEACTIVATED',
        entityType: 'employee',
        entityId: id,
        before: { status: before.status, separatedOn: before.separatedOn },
        after: { status: after.status, separatedOn: after.separatedOn },
        reason: dto.reason,
        metadata: endedMappings.length ? { endedBiometricMappings: endedMappings } : null,
      });
      return after;
    });
  }

  async listBiometricIds(employeeId: string, actor: Actor): Promise<BiometricIdView[]> {
    await this.loadInScope(this.dataSource.manager, employeeId, actor);
    const rows = await this.dataSource.getRepository(EmployeeBiometricIdEntity).find({
      where: { employeeId },
      order: { validFrom: 'DESC', createdAt: 'DESC' },
    });
    return rows.map(toBiometricView);
  }

  async addBiometricId(
    employeeId: string,
    dto: CreateBiometricIdDto,
    actor: Actor,
    ctx: RequestContext,
  ): Promise<BiometricIdView> {
    const validTo = dto.validTo ?? null;
    assertDatesInOrder(dto.validFrom, validTo, 'validTo');
    if (!(await this.devices.isActive(dto.deviceId))) {
      throw new ValidationFailedError([
        { field: 'deviceId', message: 'Unknown or inactive device.' },
      ]);
    }

    return this.dataSource.transaction(async (tx) => {
      await this.loadInScope(tx, employeeId, actor);
      const repo = tx.getRepository(EmployeeBiometricIdEntity);
      // 🔒 An overlapping range fails the EXCLUDE constraint → 409 BIOMETRIC_MAPPING_OVERLAP.
      const saved = await repo.save(
        repo.create({
          employeeId,
          deviceId: dto.deviceId,
          biometricIdentifier: dto.biometricIdentifier,
          validFrom: dto.validFrom,
          validTo,
          createdBy: actor.userId,
        }),
      );
      const view = toBiometricView(saved);
      await this.audit.record(tx, {
        ...ctx,
        actor,
        action: 'BIOMETRIC_ID_MAPPED',
        entityType: 'employee',
        entityId: employeeId,
        after: view,
      });
      return view;
    });
  }

  async setBiometricIdValidTo(
    employeeId: string,
    mappingId: string,
    dto: EndBiometricIdDto,
    actor: Actor,
    ctx: RequestContext,
  ): Promise<BiometricIdView> {
    return this.dataSource.transaction(async (tx) => {
      await this.loadInScope(tx, employeeId, actor);
      const repo = tx.getRepository(EmployeeBiometricIdEntity);
      const mapping = await repo.findOne({
        where: { id: mappingId, employeeId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!mapping) throw new NotFoundError('NOT_FOUND', 'Biometric ID mapping not found.');
      assertDatesInOrder(mapping.validFrom, dto.validTo, 'validTo');

      const before = toBiometricView(mapping);
      mapping.validTo = dto.validTo;
      const after = toBiometricView(await repo.save(mapping));
      await this.audit.record(tx, {
        ...ctx,
        actor,
        action: 'BIOMETRIC_ID_MAPPING_UPDATED',
        entityType: 'employee',
        entityId: employeeId,
        before,
        after,
      });
      return after;
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  /** Out of scope and "doesn't exist" both answer 404 EMPLOYEE_NOT_FOUND (API-DESIGN §3). */
  private async loadInScope(
    tx: EntityManager,
    id: string,
    actor: Actor,
    forUpdate = false,
  ): Promise<EmployeeEntity> {
    this.scope.assertCanAccessEmployee(actor, id);
    const employee = await tx.getRepository(EmployeeEntity).findOne({
      where: { id },
      ...(forUpdate && { lock: { mode: 'pessimistic_write' as const } }),
    });
    if (!employee) throw new NotFoundError('EMPLOYEE_NOT_FOUND', 'Employee not found.');
    return employee;
  }

  private async assertDepartmentActive(departmentId: string): Promise<void> {
    if (!(await this.departments.isActive(departmentId))) {
      throw new ValidationFailedError([
        { field: 'departmentId', message: 'Unknown or inactive department.' },
      ]);
    }
  }
}

function assertDatesInOrder(start: string | null, end: string | null, field: string): void {
  if (!start || !end) return;
  if (LocalDate.parse(end).isBefore(LocalDate.parse(start))) {
    const error: FieldError = { field, message: `${field} must not be before ${start}.` };
    throw new ValidationFailedError([error]);
  }
}

function toView(e: EmployeeEntity): EmployeeView {
  const fullName =
    `${e.lastName}, ${e.firstName}` +
    (e.middleName ? ` ${e.middleName}` : '') +
    (e.suffix ? ` ${e.suffix}` : '');
  return {
    id: e.id,
    employeeNumber: e.employeeNumber,
    firstName: e.firstName,
    middleName: e.middleName,
    lastName: e.lastName,
    suffix: e.suffix,
    fullName,
    email: e.email,
    departmentId: e.departmentId,
    positionTitle: e.positionTitle,
    category: e.category,
    employmentType: e.employmentType,
    status: e.status,
    hiredOn: e.hiredOn,
    separatedOn: e.separatedOn,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

function toBiometricView(m: EmployeeBiometricIdEntity): BiometricIdView {
  return {
    id: m.id,
    employeeId: m.employeeId,
    deviceId: m.deviceId,
    biometricIdentifier: m.biometricIdentifier,
    validFrom: m.validFrom,
    validTo: m.validTo,
    createdAt: m.createdAt.toISOString(),
  };
}
