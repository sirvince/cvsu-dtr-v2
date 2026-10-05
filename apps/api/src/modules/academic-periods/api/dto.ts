import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsLocalDate } from '../../../common/http/validators';
import type { PeriodHalf, PeriodStatus } from '../domain/periods';
import type { SemesterCode } from '../infrastructure/entities';

export class CreateAcademicYearDto {
  @ApiProperty({ example: '2026-2027' })
  @Matches(/^\d{4}-\d{4}$/, { message: 'code must look like 2026-2027' })
  code!: string;

  @ApiProperty({ example: '2026-08-01' })
  @IsLocalDate()
  startDate!: string;

  @ApiProperty({ example: '2027-07-31' })
  @IsLocalDate()
  endDate!: string;
}

export class CreateSemesterDto {
  @ApiProperty({ enum: ['FIRST', 'SECOND', 'MIDYEAR'] })
  @IsIn(['FIRST', 'SECOND', 'MIDYEAR'])
  code!: SemesterCode;

  @ApiProperty({ example: '2026-08-11' })
  @IsLocalDate()
  startDate!: string;

  @ApiProperty({ example: '2026-12-19' })
  @IsLocalDate()
  endDate!: string;
}

export class PlannedAdvanceDatesDto {
  @ApiPropertyOptional({ example: '2026-10-13', description: 'For days 1–15' })
  @IsOptional()
  @IsLocalDate()
  first?: string;

  @ApiPropertyOptional({ example: '2026-10-28', description: 'For days 16–end' })
  @IsOptional()
  @IsLocalDate()
  second?: string;
}

/** POST /dtr-periods/month (API-DESIGN §5.4): both halves of a month in one transaction. */
export class CreateMonthDto {
  @ApiProperty({ example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @ApiProperty({ example: 10, minimum: 1, maximum: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Defaults to the semester covering each half',
  })
  @IsOptional()
  @IsUUID()
  semesterId?: string;

  @ApiPropertyOptional({ type: PlannedAdvanceDatesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlannedAdvanceDatesDto)
  plannedAdvanceDates?: PlannedAdvanceDatesDto;
}

export class UpdatePeriodDto {
  @ApiPropertyOptional({ example: '2026-10-28', nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsLocalDate()
  plannedAdvanceDate?: string | null;

  @ApiPropertyOptional({ example: '2026-11-05', nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsLocalDate()
  submissionDeadline?: string | null;
}

export class ListPeriodsQuery {
  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({ enum: ['DRAFT', 'OPEN', 'CLOSED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'OPEN', 'CLOSED'])
  status?: PeriodStatus;
}

export interface SemesterView {
  id: string;
  academicYearId: string;
  code: SemesterCode;
  startDate: string;
  endDate: string;
  status: string;
}

export interface AcademicYearView {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  status: string;
  semesters: SemesterView[];
}

export interface PeriodView {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  periodHalf: PeriodHalf;
  semesterId: string | null;
  plannedAdvanceDate: string | null;
  submissionDeadline: string | null;
  status: PeriodStatus;
  /** API-DESIGN §5.4: summary of ADVANCE runs; null until the first one (BE-029). */
  advance: { lastProcessedUntil: string; openCredits: number } | null;
}
