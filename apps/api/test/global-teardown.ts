import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export default async function globalTeardown(): Promise<void> {
  const container = (globalThis as { __TEST_DB__?: StartedPostgreSqlContainer }).__TEST_DB__;
  await container?.stop();
}
