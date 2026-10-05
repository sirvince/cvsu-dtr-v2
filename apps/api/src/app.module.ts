import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { JwtAuthGuard, RolesGuard } from './common/auth/guards';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './common/http/response-envelope.interceptor';
import { createValidationPipe } from './common/http/validation';
import { buildPinoHttpOptions } from './common/logging/pino-options';
import { ClockModule } from './common/time/clock.module';
import { AppConfig, AppConfigModule } from './config/app-config';
import { DatabaseModule } from './database/database.module';
import { AcademicPeriodsModule } from './modules/academic-periods/academic-periods.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { DevicesModule } from './modules/devices/devices.module';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: buildPinoHttpOptions({
          nodeEnv: config.get('NODE_ENV'),
          logLevel: config.get('LOG_LEVEL'),
        }),
      }),
    }),
    // Generous default per client IP. Login, uploads and exports add stricter @Throttle() limits.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ClockModule,
    DatabaseModule,
    AuditModule,
    AuthModule,
    HealthModule,
    DepartmentsModule,
    DevicesModule,
    EmployeesModule,
    AcademicPeriodsModule,
    CalendarModule,
    SchedulesModule,
  ],
  providers: [
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    // Order matters: rate limit, then authenticate (unless @Public), then @Roles.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
