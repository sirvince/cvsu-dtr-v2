import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig } from '../../config/app-config';

/**
 * Minimal readiness check against PostgreSQL. It connects lazily, so the API still starts
 * (and `/health` still answers) while the database is down.
 * BE-003 replaces this with a query on the TypeORM DataSource.
 */
@Injectable()
export class DatabasePing implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.get('DATABASE_URL'),
      max: 1,
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 10_000,
    });
    // An idle client dying (DB restart) must not crash the process.
    this.pool.on('error', () => undefined);
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
