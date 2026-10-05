import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Actor } from '../../../common/actor';
import { CurrentActor, Roles } from '../../../common/auth/decorators';
import { ValidationFailedError } from '../../../common/domain/domain-error';
import { requestContext } from '../../../common/http/request-context';
import { SchedulesService } from '../application/schedules.service';
import {
  type AssignResult,
  AssignScheduleDto,
  CreateEmployeeScheduleDto,
  ReplaceBlocksDto,
  type ScheduleView,
  type TemplateView,
} from './dto';

/** API-DESIGN §5.5. Phase 1: HR creates schedules directly as APPROVED (no workflow). */
@ApiTags('schedules')
@ApiBearerAuth()
@Controller()
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get('schedule-templates')
  @Roles('HR_ADMIN', 'HR_STAFF')
  templates(): Promise<TemplateView[]> {
    return this.schedules.listTemplates();
  }

  @Post('schedules/assign')
  @Roles('HR_ADMIN')
  assign(
    @Body() dto: AssignScheduleDto,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<AssignResult> {
    return this.schedules.assign(dto, actor, requestContext(req));
  }

  @Get('schedules/:id')
  @Roles('HR_ADMIN', 'HR_STAFF')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor): Promise<ScheduleView> {
    return this.schedules.get(id, actor);
  }

  @Get('employees/:id/schedules')
  @Roles('HR_ADMIN', 'HR_STAFF')
  listForEmployee(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<ScheduleView[]> {
    return this.schedules.listForEmployee(id, actor);
  }

  @Post('employees/:id/schedules')
  @Roles('HR_ADMIN')
  createForEmployee(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateEmployeeScheduleDto,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<ScheduleView> {
    return this.schedules.createForEmployee(id, dto, actor, requestContext(req));
  }

  @Put('employees/:id/schedules/:scheduleId')
  @Roles('HR_ADMIN')
  @ApiHeader({
    name: 'If-Match',
    description: 'rowVersion from the last read (ADR-38)',
    required: true,
  })
  replaceBlocks(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Body() dto: ReplaceBlocksDto,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<ScheduleView> {
    return this.schedules.replaceBlocks(
      id,
      scheduleId,
      dto,
      parseIfMatch(ifMatch),
      actor,
      requestContext(req),
    );
  }
}

/** `If-Match: 3` (or the quoted ETag form `"3"`) → 3. Required on schedule updates (API-DESIGN §1). */
function parseIfMatch(value: string | undefined): number {
  const version = Number(value?.trim().replace(/^W\//, '').replace(/^"|"$/g, ''));
  if (!value || !Number.isInteger(version) || version < 1) {
    throw new ValidationFailedError([
      { field: 'If-Match', message: 'Send the schedule rowVersion in the If-Match header.' },
    ]);
  }
  return version;
}
