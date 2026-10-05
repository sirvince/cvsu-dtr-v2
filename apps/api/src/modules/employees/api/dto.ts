import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/paginated';
import { IsLocalDate, trim, trimToNull } from '../../../common/http/validators';
import {
  EMPLOYEE_CATEGORIES,
  EMPLOYMENT_TYPES,
  type EmployeeCategory,
  type EmploymentType,
} from '../infrastructure/entities';

export class CreateEmployeeDto {
  @ApiProperty({ example: '2019-0123' })
  @Transform(trim)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9-]{0,29}$/, {
    message: 'employeeNumber must be 1–30 letters, digits or -',
  })
  employeeNumber!: string;

  @ApiProperty({ example: 'Juan' })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  firstName!: string;

  @ApiPropertyOptional({ example: 'Santos', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @Length(1, 100)
  middleName?: string | null;

  @ApiProperty({ example: 'Dela Cruz' })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  lastName!: string;

  @ApiPropertyOptional({ example: 'Jr.', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @Length(1, 20)
  suffix?: string | null;

  @ApiPropertyOptional({ example: 'juan.delacruz@cvsu.edu.ph', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  departmentId!: string;

  @ApiPropertyOptional({ example: 'Administrative Officer II', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @Length(1, 200)
  positionTitle?: string | null;

  @ApiProperty({ enum: EMPLOYEE_CATEGORIES })
  @IsIn(EMPLOYEE_CATEGORIES)
  category!: EmployeeCategory;

  @ApiProperty({ enum: EMPLOYMENT_TYPES })
  @IsIn(EMPLOYMENT_TYPES)
  employmentType!: EmploymentType;

  @ApiPropertyOptional({ example: '2019-06-01', nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsLocalDate()
  hiredOn?: string | null;
}

/** Status changes go through POST /deactivate, not PATCH. */
export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {}

export class DeactivateEmployeeDto {
  @ApiPropertyOptional({ example: '2026-10-31', description: 'Last day of service' })
  @IsOptional()
  @IsLocalDate()
  separatedOn?: string;

  @ApiProperty({ example: 'Retired' })
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  reason!: string;
}

export const EMPLOYEE_SORT_FIELDS = ['lastName', 'employeeNumber', 'createdAt'] as const;
export type EmployeeSortField = (typeof EMPLOYEE_SORT_FIELDS)[number];

export class ListEmployeesQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Searches name and employee number' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  /** API-DESIGN §1: sorting only on a whitelist. Anything else is a 400. */
  @ApiPropertyOptional({ enum: EMPLOYEE_SORT_FIELDS, default: 'lastName' })
  @IsOptional()
  @IsIn(EMPLOYEE_SORT_FIELDS)
  sort: EmployeeSortField = 'lastName';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'asc';
}

export class CreateBiometricIdDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  deviceId!: string;

  @ApiProperty({ example: '1001', description: 'Enrolment number on the device' })
  @Transform(trim)
  @Matches(/^[A-Za-z0-9_-]{1,32}$/, {
    message: 'biometricIdentifier must be 1–32 letters, digits, - or _',
  })
  biometricIdentifier!: string;

  @ApiProperty({ example: '2026-01-01' })
  @IsLocalDate()
  validFrom!: string;

  @ApiPropertyOptional({ example: null, nullable: true, description: 'Inclusive; null = open' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsLocalDate()
  validTo?: string | null;
}

/** PATCH …/biometric-ids/:mappingId: end (or reopen with null) a mapping. Required, unlike on create. */
export class EndBiometricIdDto {
  @ApiProperty({
    example: '2026-06-30',
    nullable: true,
    description: 'Inclusive last day; null = open',
  })
  @ValidateIf((_o, v) => v !== null)
  @IsLocalDate()
  validTo!: string | null;
}

export interface EmployeeView {
  id: string;
  employeeNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  fullName: string;
  email: string | null;
  departmentId: string;
  positionTitle: string | null;
  category: EmployeeCategory;
  employmentType: EmploymentType;
  status: 'ACTIVE' | 'INACTIVE';
  hiredOn: string | null;
  separatedOn: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BiometricIdView {
  id: string;
  employeeId: string;
  deviceId: string;
  biometricIdentifier: string;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
}
