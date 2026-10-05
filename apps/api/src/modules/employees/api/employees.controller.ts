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
import type { Paginated } from '../../../common/http/paginated';
import { requestContext } from '../../../common/http/request-context';
import { EmployeesService } from '../application/employees.service';
import {
  type BiometricIdView,
  CreateBiometricIdDto,
  CreateEmployeeDto,
  DeactivateEmployeeDto,
  type EmployeeView,
  EndBiometricIdDto,
  ListEmployeesQuery,
  UpdateEmployeeDto,
} from './dto';

/** API-DESIGN §4: HR_ADMIN (all), HR_STAFF (in scope; none in Phase 1). No DELETE route. */
@ApiTags('employees')
@ApiBearerAuth()
@Controller('employees')
@Roles('HR_ADMIN', 'HR_STAFF')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  list(
    @Query() query: ListEmployeesQuery,
    @CurrentActor() actor: Actor,
  ): Promise<Paginated<EmployeeView>> {
    return this.employees.list(query, actor);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor): Promise<EmployeeView> {
    return this.employees.get(id, actor);
  }

  @Post()
  create(
    @Body() dto: CreateEmployeeDto,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<EmployeeView> {
    return this.employees.create(dto, actor, requestContext(req));
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<EmployeeView> {
    return this.employees.update(id, dto, actor, requestContext(req));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeactivateEmployeeDto,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<EmployeeView> {
    return this.employees.deactivate(id, dto, actor, requestContext(req));
  }

  @Get(':id/biometric-ids')
  listBiometricIds(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<BiometricIdView[]> {
    return this.employees.listBiometricIds(id, actor);
  }

  @Post(':id/biometric-ids')
  addBiometricId(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBiometricIdDto,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<BiometricIdView> {
    return this.employees.addBiometricId(id, dto, actor, requestContext(req));
  }

  @Patch(':id/biometric-ids/:mappingId')
  setBiometricIdValidTo(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mappingId', ParseUUIDPipe) mappingId: string,
    @Body() dto: EndBiometricIdDto,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<BiometricIdView> {
    return this.employees.setBiometricIdValidTo(id, mappingId, dto, actor, requestContext(req));
  }
}
