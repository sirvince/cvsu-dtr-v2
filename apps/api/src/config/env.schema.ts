import { z } from 'zod';
import { BUSINESS_TIMEZONE } from '../common/time/clock';

/**
 * Every environment variable the API reads (STACK §8, `.env.example`).
 * The app refuses to start when this doesn't parse. Later tickets add their own
 * keys here (JWT_* in BE-004, FILE_STORAGE_* in BE-010).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: (issue) => (issue.input === undefined ? 'is required' : 'must be a postgres:// URL'),
  }),
  WEB_ORIGIN: z.url({ protocol: /^https?$/ }).default('http://localhost:5173'),
  BUSINESS_TIMEZONE: z.literal(BUSINESS_TIMEZONE).default(BUSINESS_TIMEZONE),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Number of reverse proxies in front of the API (1 behind Nginx). Needed for correct client IPs. */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  WORKER: z.stringbool().default(false),
});

export type Env = z.infer<typeof envSchema>;

/** Used by ConfigModule. Throws one readable error listing every problem; never echoes values. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
