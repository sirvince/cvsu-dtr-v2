import { resolve } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { buildDataSourceOptions } from '../../src/database/data-source-options';

/** The same role bootstrap the dev compose file mounts, so tests exercise the real grants. */
const INIT_DIR = resolve(__dirname, '../../../../infra/postgres/init');
const DB = 'cvsu_dtr';

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  superuserUrl: string;
  migratorUrl: string;
  appUrl: string;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:17')
    .withDatabase(DB)
    .withUsername('postgres')
    .withPassword('postgres')
    .withEnvironment({ MIGRATOR_PASSWORD: 'migrator', APP_USER_PASSWORD: 'app_user' })
    .withCopyDirectoriesToContainer([{ source: INIT_DIR, target: '/docker-entrypoint-initdb.d' }])
    .start();

  const url = (user: string, password: string) =>
    `postgres://${user}:${password}@${container.getHost()}:${container.getPort()}/${DB}`;

  return {
    container,
    superuserUrl: url('postgres', 'postgres'),
    migratorUrl: url('migrator', 'migrator'),
    appUrl: url('app_user', 'app_user'),
  };
}

export async function connect(
  url: string,
  extra: Partial<DataSourceOptions> = {},
): Promise<DataSource> {
  return new DataSource({
    ...buildDataSourceOptions(url),
    ...extra,
  } as DataSourceOptions).initialize();
}

/** Runs every migration as `migrator`, the way deploys do. */
export async function migrate(migratorUrl: string): Promise<void> {
  const ds = await connect(migratorUrl);
  try {
    await ds.runMigrations({ transaction: 'each' });
  } finally {
    await ds.destroy();
  }
}
