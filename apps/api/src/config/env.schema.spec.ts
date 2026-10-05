import { validateEnv } from './env.schema';

const valid = {
  DATABASE_URL: 'postgres://app_user:pw@localhost:5432/cvsu_dtr',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    expect(validateEnv(valid)).toEqual({
      ...valid,
      NODE_ENV: 'development',
      PORT: 3000,
      WEB_ORIGIN: 'http://localhost:5173',
      BUSINESS_TIMEZONE: 'Asia/Manila',
      LOG_LEVEL: 'info',
      TRUST_PROXY: 0,
      WORKER: false,
      JWT_ACCESS_TTL: 900,
      REFRESH_TOKEN_TTL_DAYS: 7,
    });
  });

  it('coerces strings from the environment', () => {
    const env = validateEnv({ ...valid, PORT: '8080', TRUST_PROXY: '1', WORKER: 'true' });
    expect(env).toMatchObject({ PORT: 8080, TRUST_PROXY: 1, WORKER: true });
  });

  it('refuses to start without DATABASE_URL, with a clear message', () => {
    expect(() => validateEnv({})).toThrow(
      /Invalid environment configuration[\s\S]*is required[\s\S]*DATABASE_URL/,
    );
  });

  it('refuses a short JWT secret', () => {
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('lists every problem and never echoes the values', () => {
    let message = '';
    try {
      validateEnv({
        DATABASE_URL: 'mysql://root:hunter2@db/x',
        PORT: 'abc',
        BUSINESS_TIMEZONE: 'UTC',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/PORT/);
    expect(message).toMatch(/BUSINESS_TIMEZONE/);
    expect(message).not.toContain('hunter2');
  });
});
