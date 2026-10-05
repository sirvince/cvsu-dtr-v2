// Runs before any test module is imported: ConfigModule validates the environment at import time.
// DATABASE_URL comes from global-setup.ts (e2e) or is set by the suite itself (int).
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
