import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import type { Actor, RequestContext } from '../../common/actor';
import { NotFoundError } from '../../common/domain/domain-error';
import { AuditService } from '../audit/audit.service';
import { DepartmentEntity } from './department.entity';
import type {
  CreateDepartmentDto,
  DepartmentView,
  ListDepartmentsQuery,
  UpdateDepartmentDto,
} from './departments.dto';

/** Small CRUD module: application and domain collapse into this service (dtr-backend skill). */
@Injectable()
export class DepartmentsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListDepartmentsQuery): Promise<DepartmentView[]> {
    const rows = await this.dataSource.getRepository(DepartmentEntity).find({
      where: query.status ? { status: query.status } : {},
      order: { name: 'ASC' },
    });
    return rows.map(toView);
  }

  async get(id: string): Promise<DepartmentView> {
    return toView(await this.load(this.dataSource.manager, id));
  }

  /** Public: for other modules. True when the department exists and is ACTIVE. */
  async isActive(id: string): Promise<boolean> {
    return this.dataSource.getRepository(DepartmentEntity).existsBy({ id, status: 'ACTIVE' });
  }

  async create(
    dto: CreateDepartmentDto,
    actor: Actor,
    ctx: RequestContext,
  ): Promise<DepartmentView> {
    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(DepartmentEntity);
      const saved = await repo.save(
        repo.create({
          code: dto.code,
          name: dto.name,
          campus: dto.campus ?? null,
          status: 'ACTIVE',
        }),
      );
      const view = toView(saved);
      await this.audit.record(tx, {
        ...ctx,
        actor,
        action: 'DEPARTMENT_CREATED',
        entityType: 'department',
        entityId: saved.id,
        after: view,
      });
      return view;
    });
  }

  async update(
    id: string,
    dto: UpdateDepartmentDto,
    actor: Actor,
    ctx: RequestContext,
  ): Promise<DepartmentView> {
    return this.dataSource.transaction(async (tx) => {
      const department = await this.load(tx, id, true);
      const before = toView(department);
      if (dto.code !== undefined) department.code = dto.code;
      if (dto.name !== undefined) department.name = dto.name;
      if (dto.campus !== undefined) department.campus = dto.campus;
      const after = toView(await tx.getRepository(DepartmentEntity).save(department));
      await this.audit.record(tx, {
        ...ctx,
        actor,
        action: 'DEPARTMENT_UPDATED',
        entityType: 'department',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }

  /** Master data is deactivated, never deleted (DATABASE-MAPPING §1). Idempotent. */
  async deactivate(id: string, actor: Actor, ctx: RequestContext): Promise<DepartmentView> {
    return this.dataSource.transaction(async (tx) => {
      const department = await this.load(tx, id, true);
      if (department.status === 'INACTIVE') return toView(department);
      department.status = 'INACTIVE';
      const view = toView(await tx.getRepository(DepartmentEntity).save(department));
      await this.audit.record(tx, {
        ...ctx,
        actor,
        action: 'DEPARTMENT_DEACTIVATED',
        entityType: 'department',
        entityId: id,
        before: { status: 'ACTIVE' },
        after: { status: 'INACTIVE' },
      });
      return view;
    });
  }

  private async load(tx: EntityManager, id: string, forUpdate = false): Promise<DepartmentEntity> {
    const department = await tx.getRepository(DepartmentEntity).findOne({
      where: { id },
      ...(forUpdate && { lock: { mode: 'pessimistic_write' as const } }),
    });
    if (!department) throw new NotFoundError('NOT_FOUND', 'Department not found.');
    return department;
  }
}

function toView(d: DepartmentEntity): DepartmentView {
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    campus: d.campus,
    status: d.status,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}
