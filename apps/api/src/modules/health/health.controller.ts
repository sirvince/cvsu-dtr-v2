import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { Public } from '../../common/auth/decorators';
import { SkipEnvelope } from '../../common/http/response-envelope.interceptor';

@ApiTags('health')
@Controller('health')
@Public()
@SkipThrottle()
@SkipEnvelope()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** Liveness: the process is up. No details (API-DESIGN §5.11). */
  @Get()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: dependencies are reachable. Internal only; Nginx doesn't expose it. */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([() => this.checkDatabase()]);
  }

  private async checkDatabase() {
    const indicator = this.indicators.check('database');
    try {
      await this.dataSource.query('SELECT 1');
      return indicator.up();
    } catch {
      // The driver message can include host names; keep it out of the response.
      return indicator.down({ message: 'unreachable' });
    }
  }
}
