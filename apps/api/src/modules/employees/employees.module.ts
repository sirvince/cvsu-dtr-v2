import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DepartmentsModule } from '../departments/departments.module';
import { DevicesModule } from '../devices/devices.module';
import { EmployeesController } from './api/employees.controller';
import { EmployeesService } from './application/employees.service';
import { EmployeeBiometricIdEntity, EmployeeEntity } from './infrastructure/entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([EmployeeEntity, EmployeeBiometricIdEntity]),
    DepartmentsModule,
    DevicesModule,
  ],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
