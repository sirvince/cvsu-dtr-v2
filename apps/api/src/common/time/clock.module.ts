import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { CLOCK, SystemClock } from './clock';

/** Provides the Clock port. Tests override CLOCK with a FixedClock. */
@Global()
@Module({
  providers: [
    {
      provide: CLOCK,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => new SystemClock(config.get('BUSINESS_TIMEZONE')),
    },
  ],
  exports: [CLOCK],
})
export class ClockModule {}
