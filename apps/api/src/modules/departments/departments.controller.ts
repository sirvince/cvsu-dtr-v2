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
import type { Actor } from '../../common/actor';
import { CurrentActor, Roles } from '../../common/auth/decorators';
import { requestContext } from '../../common/http/request-context';
import {
  CreateDepartmentDto,
  type DepartmentView,
  ListDepartmentsQuery,
  UpdateDepartmentDto,
} from './departments.dto';
import { DepartmentsService } from './departments.service';

/** API-DESIGN §4: manage departments = HR_ADMIN, SYSTEM_ADMIN. */
@ApiTags('departments')
@ApiBearerAuth()
@Controller('departments')
@Roles('HR_ADMIN', 'SYSTEM_ADMIN')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  list(@Query() query: ListDepartmentsQuery): Promise<DepartmentView[]> {
    return this.departments.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<DepartmentView> {
    return this.departments.get(id);
  }

  @Post()
  create(
    @Body() dto: CreateDepartmentDto,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<DepartmentView> {
    return this.departments.create(dto, actor, requestContext(req));
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<DepartmentView> {
    return this.departments.update(id, dto, actor, requestContext(req));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<DepartmentView> {
    return this.departments.deactivate(id, actor, requestContext(req));
  }
}
