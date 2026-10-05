import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { IsLocalDate, IsLocalTime, trim, trimToNull } from '../../common/http/validators';

/** Phase 1 types (BE-008). CAMPUS_EVENT exists in the schema for later. */
export const CALENDAR_EVENT_TYPES = [
  'REGULAR_HOLIDAY',
  'SPECIAL_NON_WORKING',
  'SPECIAL_WORKING',
  'WORK_SUSPENSION',
  'GOVERNMENT_ANNOUNCEMENT',
] as const;
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number] | 'CAMPUS_EVENT';

/** Types that only make sense for a whole day (BUSINESS-RULES §5.6). */
export const WHOLE_DAY_TYPES: readonly CalendarEventType[] = [
  'REGULAR_HOLIDAY',
  'SPECIAL_NON_WORKING',
  'SPECIAL_WORKING',
];

export class CreateCalendarEventDto {
  @ApiProperty({ example: '2026-11-30' })
  @IsLocalDate()
  eventDate!: string;

  @ApiProperty({ enum: CALENDAR_EVENT_TYPES })
  @IsIn(CALENDAR_EVENT_TYPES)
  type!: (typeof CALENDAR_EVENT_TYPES)[number];

  @ApiProperty({ example: 'Bonifacio Day' })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional({
    example: '15:00',
    description: 'Partial day: excused from this time (suspensions, announcements)',
  })
  @IsOptional()
  @IsLocalTime()
  startTime?: string;

  @ApiPropertyOptional({ example: '17:00', description: 'Optional end of the excused time' })
  @IsOptional()
  @IsLocalTime()
  endTime?: string;

  @ApiPropertyOptional({ example: 'Proclamation No. 727, s. 2024', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @Length(1, 300)
  reference?: string | null;
}

export class ListCalendarEventsQuery {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsLocalDate()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsLocalDate()
  to?: string;

  @ApiPropertyOptional({ enum: CALENDAR_EVENT_TYPES })
  @IsOptional()
  @IsIn(CALENDAR_EVENT_TYPES)
  type?: (typeof CALENDAR_EVENT_TYPES)[number];
}

export interface CalendarEventView {
  id: string;
  eventDate: string;
  type: CalendarEventType;
  name: string;
  /** null = whole day */
  startTime: string | null;
  endTime: string | null;
  scope: 'ALL' | 'DEPARTMENTS';
  excusesAttendance: boolean;
  reference: string | null;
  createdAt: string;
}
