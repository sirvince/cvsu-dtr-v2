import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { Actor, RequestContext } from '../../common/actor';
import { AuditLog } from './audit-log.entity';

export interface AuditEntry extends Partial<RequestContext> {
  /** null = the system (jobs, automatic reconciliation) */
  actor: Actor | null;
  /** e.g. DTR_FINALIZED, ATTENDANCE_IMPORT_COMMITTED, DTR_VIEWED (sensitive read) */
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * The audit trail (MODULES §4 audit). A leaf module: it imports nothing from business modules.
 * Always pass the use case's transaction manager, so the state change, its history and its
 * audit row commit or roll back together. Outside a transaction, pass `dataSource.manager`.
 */
@Injectable()
export class AuditService {
  async record(tx: EntityManager, entry: AuditEntry): Promise<void> {
    const row: Omit<AuditLog, 'id' | 'occurredAt'> = {
      actorUserId: entry.actor?.userId ?? null,
      actorRoles: entry.actor ? [...entry.actor.roles] : null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      requestId: entry.requestId ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      reason: entry.reason ?? null,
      metadata: entry.metadata ?? null,
    };
    // TypeORM's insert type can't express jsonb columns holding `unknown`; `row` is fully typed above.
    await tx.getRepository(AuditLog).insert(row as QueryDeepPartialEntity<AuditLog>);
  }
}
