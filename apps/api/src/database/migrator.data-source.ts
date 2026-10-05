import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { DataSource } from 'typeorm';
import { z } from 'zod';
import { buildDataSourceOptions } from './data-source-options';

/**
 * DataSource for the TypeORM CLI (`yarn workspace @cvsu-dtr/api migration:run`).
 * It connects as `migrator`, the DDL owner, never as app_user. This is a CLI entry point,
 * not a Nest module, so it reads the environment itself.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

const url = z.url({ protocol: /^postgres(ql)?$/ }).safeParse(process.env.DATABASE_MIGRATOR_URL);
if (!url.success) {
  throw new Error('DATABASE_MIGRATOR_URL must be set to a postgres:// URL for the migrator role');
}

export default new DataSource({
  ...buildDataSourceOptions(url.data),
  // Only for migration:generate, which diffs entities against the schema.
  entities: [`${__dirname}/../**/*.entity${extname(__filename)}`],
});
