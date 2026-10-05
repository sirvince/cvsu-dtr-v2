import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ClockModule } from '../common/time/clock.module';
import { AppConfigModule } from '../config/app-config';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../modules/audit/audit.module';
import { AuthModule } from '../modules/auth/auth.module';
import { DevicesModule } from '../modules/devices/devices.module';

/**
 * What the operator CLIs need, without the HTTP layer. Connects as app_user like the API.
 * ThrottlerModule is here only because AuthModule's controller references the throttler guard.
 */
@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    DatabaseModule,
    AuditModule,
    AuthModule,
    DevicesModule,
    ThrottlerModule.forRoot([]),
  ],
})
export class CliModule {}
