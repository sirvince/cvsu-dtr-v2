import { migrate, startTestDatabase } from './support/postgres';

/**
 * e2e: one migrated PostgreSQL container for the whole run. The app connects as app_user,
 * exactly like production. Workers inherit process.env from here.
 */
export default async function globalSetup(): Promise<void> {
  const db = await startTestDatabase();
  await migrate(db.migratorUrl);
  process.env.DATABASE_URL = db.appUrl;
  (globalThis as { __TEST_DB__?: unknown }).__TEST_DB__ = db.container;
}
