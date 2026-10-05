// Runs before any test module is imported: ConfigModule validates the environment at import time.
// The database is unreachable on purpose; nothing in the foundation tests needs it,
// and /health/ready must report it down.
process.env.DATABASE_URL = 'postgres://app_user:pw@127.0.0.1:1/cvsu_dtr';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
