// Runs before any test module is imported: ConfigModule validates the environment at import time.
// DATABASE_URL comes from global-setup.ts (e2e) or is set by the suite itself (int).
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_ACCESS_SECRET = 'test-only-secret-that-is-long-enough-for-hs256';
// Tests send X-Forwarded-For to act as distinct clients for the per-IP rate limits.
process.env.TRUST_PROXY = '1';
