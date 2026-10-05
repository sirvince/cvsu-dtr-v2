import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import type { BlockInput } from '../domain/schedule';

export type ScheduleStatus =
  'DRAFT' | 'SUBMITTED' | 'ENDORSED' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';

/** DATABASE-MAPPING §5 */
@Entity('schedule_templates')
export class ScheduleTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'jsonb' })
  blocks!: BlockInput[];

  @Column({ type: 'text' })
  status!: string;
}

@Entity('employee_schedules')
export class EmployeeScheduleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId!: string;

  @Column({ name: 'semester_id', type: 'uuid' })
  semesterId!: string;

  @Column({ name: 'effective_from', type: 'date' })
  effectiveFrom!: string;

  @Column({ name: 'effective_to', type: 'date' })
  effectiveTo!: string;

  @Column({ type: 'text' })
  status!: ScheduleStatus;

  /** Business version: +1 for each new version of the employee's schedule in the semester. */
  @Column({ type: 'int' })
  version!: number;

  /** Optimistic lock, exposed as If-Match (ADR-38). Never the business version. */
  @VersionColumn({ name: 'row_version' })
  rowVersion!: number;

  @Column({ name: 'approved_directly', type: 'boolean' })
  approvedDirectly!: boolean;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ name: 'review_remarks', type: 'text', nullable: true })
  reviewRemarks!: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('schedule_blocks')
export class ScheduleBlockEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'employee_schedule_id', type: 'uuid' })
  employeeScheduleId!: string;

  @Column({ name: 'day_of_week', type: 'smallint' })
  dayOfWeek!: number;

  @Column({ name: 'block_no', type: 'smallint' })
  blockNo!: number;

  /** 'HH:mm:ss' from PostgreSQL */
  @Column({ name: 'start_time', type: 'time' })
  startTime!: string;

  @Column({ name: 'end_time', type: 'time' })
  endTime!: string;
}

export const SCHEDULE_ENTITIES = [
  ScheduleTemplateEntity,
  EmployeeScheduleEntity,
  ScheduleBlockEntity,
];
