import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { DatabasePing } from './database-ping';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule.forRoot({ logger: false })],
  controllers: [HealthController],
  providers: [DatabasePing],
})
export class HealthModule {}
