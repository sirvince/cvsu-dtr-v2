import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademicYearsController, PeriodsController } from './api/controllers';
import { AcademicYearsService } from './application/academic-years.service';
import { PeriodsService } from './application/periods.service';
import { AcademicYearEntity, DtrPeriodEntity, SemesterEntity } from './infrastructure/entities';

@Module({
  imports: [TypeOrmModule.forFeature([AcademicYearEntity, SemesterEntity, DtrPeriodEntity])],
  controllers: [AcademicYearsController, PeriodsController],
  providers: [AcademicYearsService, PeriodsService],
  exports: [PeriodsService],
})
export class AcademicPeriodsModule {}
