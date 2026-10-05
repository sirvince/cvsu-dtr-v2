import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademicPeriodsModule } from '../academic-periods/academic-periods.module';
import { EmployeesModule } from '../employees/employees.module';
import { SchedulesController } from './api/controllers';
import { SchedulesService } from './application/schedules.service';
import { SCHEDULE_ENTITIES } from './infrastructure/entities';

@Module({
  imports: [TypeOrmModule.forFeature(SCHEDULE_ENTITIES), EmployeesModule, AcademicPeriodsModule],
  controllers: [SchedulesController],
  providers: [SchedulesService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
