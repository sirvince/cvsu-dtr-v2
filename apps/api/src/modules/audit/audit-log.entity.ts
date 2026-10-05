import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** DATABASE-MAPPING §10. Append-only: app_user can only INSERT and SELECT. */
@Entity('audit_logs')
export class AuditLog {
  // bigint comes back from pg as a string; keep it one to avoid precision loss.
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz', insert: false })
  occurredAt!: Date;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ name: 'actor_roles', type: 'text', array: true, nullable: true })
  actorRoles!: string[] | null;

  @Column({ type: 'text' })
  action!: string;

  @Column({ name: 'entity_type', type: 'text' })
  entityType!: string;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId!: string | null;

  @Column({ name: 'request_id', type: 'text', nullable: true })
  requestId!: string | null;

  @Column({ type: 'inet', nullable: true })
  ip!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  before!: unknown;

  @Column({ type: 'jsonb', nullable: true })
  after!: unknown;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;
}
