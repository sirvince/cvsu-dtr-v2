import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const EMPLOYEE_CATEGORIES = ['FACULTY', 'NON_TEACHING'] as const;
export const EMPLOYMENT_TYPES = [
  'PERMANENT',
  'TEMPORARY',
  'CONTRACTUAL',
  'CASUAL',
  'PART_TIME',
  'COS',
  'JO',
] as const;
export type EmployeeCategory = (typeof EMPLOYEE_CATEGORIES)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** DATABASE-MAPPING §5. `date` columns stay 'YYYY-MM-DD' strings (pg parser, BE-003). */
@Entity('employees')
export class EmployeeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'employee_number', type: 'text' })
  employeeNumber!: string;

  @Column({ name: 'first_name', type: 'text' })
  firstName!: string;

  @Column({ name: 'middle_name', type: 'text', nullable: true })
  middleName!: string | null;

  @Column({ name: 'last_name', type: 'text' })
  lastName!: string;

  @Column({ type: 'text', nullable: true })
  suffix!: string | null;

  @Column({ type: 'citext', nullable: true })
  email!: string | null;

  @Column({ name: 'department_id', type: 'uuid' })
  departmentId!: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'position_title', type: 'text', nullable: true })
  positionTitle!: string | null;

  @Column({ type: 'text' })
  category!: EmployeeCategory;

  @Column({ name: 'employment_type', type: 'text' })
  employmentType!: EmploymentType;

  @Column({ type: 'text' })
  status!: 'ACTIVE' | 'INACTIVE';

  @Column({ name: 'hired_on', type: 'date', nullable: true })
  hiredOn!: string | null;

  @Column({ name: 'separated_on', type: 'date', nullable: true })
  separatedOn!: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** 🔒 One device + identifier → at most one employee on any date (EXCLUDE constraint). */
@Entity('employee_biometric_ids')
export class EmployeeBiometricIdEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId!: string;

  @Column({ name: 'device_id', type: 'uuid' })
  deviceId!: string;

  @Column({ name: 'biometric_identifier', type: 'text' })
  biometricIdentifier!: string;

  @Column({ name: 'valid_from', type: 'date' })
  validFrom!: string;

  /** null = open-ended. The range is inclusive on both ends ('[]'). */
  @Column({ name: 'valid_to', type: 'date', nullable: true })
  validTo!: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
