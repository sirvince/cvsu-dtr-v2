import { createHash, randomBytes } from 'node:crypto';

export const REFRESH_COOKIE = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** An opaque 256-bit token (SECURITY-PRIVACY §2). The raw value only ever goes to the cookie. */
export function newRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashRefreshToken(raw) };
}

/** What the database stores and looks up: never the raw token. */
export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
