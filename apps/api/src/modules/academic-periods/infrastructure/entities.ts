import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { PeriodHalf, PeriodStatus } from '../domain/periods';

export type SemesterCode = 'FIRST' | 'SECOND' | 'MIDYEAR';

/** DATABASE-MAPPING §5. Dates are 'YYYY-MM-DD' strings. */
@Entity('academic_years')
export class AcademicYearEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  code!: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;

  @Column({ type: 'text' })
  status!: string;
}

@Entity('semesters')
export class SemesterEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'academic_year_id', type: 'uuid' })
  academicYearId!: string;

  @Column({ type: 'text' })
  code!: SemesterCode;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;

  @Column({ type: 'text' })
  status!: string;
}

@Entity('dtr_periods')
export class DtrPeriodEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;

  @Column({ name: 'period_half', type: 'smallint' })
  periodHalf!: PeriodHalf;

  @Column({ name: 'semester_id', type: 'uuid', nullable: true })
  semesterId!: string | null;

  @Column({ name: 'planned_advance_date', type: 'date', nullable: true })
  plannedAdvanceDate!: string | null;

  @Column({ name: 'submission_deadline', type: 'date', nullable: true })
  submissionDeadline!: string | null;

  @Column({ type: 'text' })
  status!: PeriodStatus;
}
