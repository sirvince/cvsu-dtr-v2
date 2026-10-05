import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Actor } from '../../../common/actor';
import { CurrentActor, Roles } from '../../../common/auth/decorators';
import { requestContext } from '../../../common/http/request-context';
import { AcademicYearsService } from '../application/academic-years.service';
import { PeriodsService } from '../application/periods.service';
import {
  type AcademicYearView,
  CreateAcademicYearDto,
  CreateMonthDto,
  CreateSemesterDto,
  ListPeriodsQuery,
  type PeriodView,
  type SemesterView,
  UpdatePeriodDto,
} from './dto';

/** API-DESIGN §4: HR_ADMIN manages periods and the calendar; HR_STAFF reads them. */
@ApiTags('academic-calendar')
@ApiBearerAuth()
@Controller('academic-years')
export class AcademicYearsController {
  constructor(private readonly years: AcademicYearsService) {}

  @Get()
  @Roles('HR_ADMIN', 'HR_STAFF')
  list(): Promise<AcademicYearView[]> {
    return this.years.list();
  }

  @Post()
  @Roles('HR_ADMIN')
  create(
    @Body() dto: CreateAcademicYearDto,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<AcademicYearView> {
    return this.years.create(dto, actor, requestContext(req));
  }

  @Post(':id/semesters')
  @Roles('HR_ADMIN')
  addSemester(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSemesterDto,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<SemesterView> {
    return this.years.addSemester(id, dto, actor, requestContext(req));
  }
}

@ApiTags('academic-calendar')
@ApiBearerAuth()
@Controller('dtr-periods')
export class PeriodsController {
  constructor(private readonly periods: PeriodsService) {}

  @Get()
  @Roles('HR_ADMIN', 'HR_STAFF')
  list(@Query() query: ListPeriodsQuery): Promise<PeriodView[]> {
    return this.periods.list(query);
  }

  /** Both halves of a month (ADR-21). Declared before :id so "month" is never read as an id. */
  @Post('month')
  @Roles('HR_ADMIN')
  createMonth(
    @Body() dto: CreateMonthDto,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<PeriodView[]> {
    return this.periods.createMonth(dto, actor, requestContext(req));
  }

  @Get(':id')
  @Roles('HR_ADMIN', 'HR_STAFF')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PeriodView> {
    return this.periods.get(id);
  }

  @Patch(':id')
  @Roles('HR_ADMIN')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePeriodDto,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<PeriodView> {
    return this.periods.update(id, dto, actor, requestContext(req));
  }

  @Post(':id/close')
  @HttpCode(200)
  @Roles('HR_ADMIN')
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<PeriodView> {
    return this.periods.close(id, actor, requestContext(req));
  }
}
