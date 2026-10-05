import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { Actor } from '../../common/actor';
import { CurrentActor, Roles } from '../../common/auth/decorators';
import { requestContext } from '../../common/http/request-context';
import {
  type CalendarEventView,
  CreateCalendarEventDto,
  ListCalendarEventsQuery,
} from './calendar.dto';
import { CalendarEventEntity, CalendarService } from './calendar.service';

@ApiTags('calendar')
@ApiBearerAuth()
@Controller('calendar-events')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @Roles('HR_ADMIN', 'HR_STAFF')
  list(@Query() query: ListCalendarEventsQuery): Promise<CalendarEventView[]> {
    return this.calendar.list(query);
  }

  @Get(':id')
  @Roles('HR_ADMIN', 'HR_STAFF')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<CalendarEventView> {
    return this.calendar.get(id);
  }

  @Post()
  @Roles('HR_ADMIN')
  create(
    @Body() dto: CreateCalendarEventDto,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<CalendarEventView> {
    return this.calendar.create(dto, actor, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles('HR_ADMIN')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<void> {
    return this.calendar.remove(id, actor, requestContext(req));
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([CalendarEventEntity])],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
