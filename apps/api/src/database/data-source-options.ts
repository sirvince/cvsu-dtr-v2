import { extname } from 'node:path';
import { types } from 'pg';
import type { DataSourceOptions } from 'typeorm';

// `date` (OID 1082) would otherwise become a JS Date at local midnight: off by one day
// depending on the server timezone. Keep it as 'YYYY-MM-DD' and wrap it in LocalDate.
types.setTypeParser(1082, (value: string) => value);

// .ts under ts-node/Jest, .js in dist/. Never *.{ts,js}: dist/ also holds .d.ts files.
export const MIGRATIONS_GLOB = `${__dirname}/migrations/*${extname(__filename)}`;

/**
 * Options shared by the app (app_user) and the migration CLI (migrator).
 * synchronize is off everywhere: the schema only changes through reviewed migrations.
 */
export function buildDataSourceOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    synchronize: false,
    migrationsRun: false,
    migrations: [MIGRATIONS_GLOB],
    migrationsTableName: 'typeorm_migrations',
    // DATABASE-MAPPING §3: instants are UTC; only the app converts to Asia/Manila.
    extra: { options: '-c TimeZone=UTC', max: 10, connectionTimeoutMillis: 5_000 },
  };
}
