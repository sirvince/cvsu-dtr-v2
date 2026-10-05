import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsLocalDate, IsLocalTime } from '../../../common/http/validators';
import type { ScheduleStatus } from '../infrastructure/entities';

export class BlockDto {
  @ApiProperty({ example: 1, description: 'ISO weekday: 1 = Monday … 7 = Sunday' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek!: number;

  @ApiProperty({ example: '07:00' })
  @IsLocalTime()
  startTime!: string;

  @ApiProperty({ example: '10:00' })
  @IsLocalTime()
  endTime!: string;
}

class ScheduleRangeDto {
  @ApiProperty({ example: '2026-10-01' })
  @IsLocalDate()
  effectiveFrom!: string;

  @ApiProperty({ example: '2026-12-19' })
  @IsLocalDate()
  effectiveTo!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Defaults to the semester covering effectiveFrom',
  })
  @IsOptional()
  @IsUUID()
  semesterId?: string;
}

/** POST /schedules/assign (API-DESIGN §5.5, ADR-35). Exactly one of departmentId / employeeIds. */
export class AssignScheduleDto extends ScheduleRangeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  templateId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @IsUUID('all', { each: true })
  employeeIds?: string[];
}

/** POST /employees/:id/schedules: per-employee blocks (faculty: several per day, ADR-32). */
export class CreateEmployeeScheduleDto extends ScheduleRangeDto {
  @ApiProperty({ type: [BlockDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(70)
  @ValidateNested({ each: true })
  @Type(() => BlockDto)
  blocks!: BlockDto[];
}

/** PUT /employees/:id/schedules/:scheduleId: replace the blocks (If-Match: rowVersion). */
export class ReplaceBlocksDto {
  @ApiProperty({ type: [BlockDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(70)
  @ValidateNested({ each: true })
  @Type(() => BlockDto)
  blocks!: BlockDto[];
}

export interface BlockView {
  dayOfWeek: number;
  blockNo: number;
  startTime: string;
  endTime: string;
}

export interface ScheduleView {
  id: string;
  employeeId: string;
  semesterId: string;
  effectiveFrom: string;
  effectiveTo: string;
  status: ScheduleStatus;
  version: number;
  rowVersion: number;
  approvedDirectly: boolean;
  createdBy: string | null;
  createdAt: string;
  blocks: BlockView[];
}

export interface TemplateView {
  id: string;
  name: string;
  status: string;
  blocks: { dayOfWeek: number; startTime: string; endTime: string }[];
}

export type SkipReason = 'NOT_FOUND' | 'INACTIVE' | 'ALREADY_ASSIGNED';

export interface AssignResult {
  created: number;
  superseded: number;
  scheduleIds: string[];
  skipped: { employeeId: string; reason: SkipReason }[];
}
