import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const BREACHED_PASSWORDS = Symbol('BREACHED_PASSWORDS');

/**
 * Loads the bundled list (copied to dist/ by nest-cli `assets`). Offline by design:
 * the server may not reach the internet, so there is no k-anonymity API call.
 */
export function loadBreachedPasswords(
  file = join(__dirname, 'breached-passwords.txt'),
): ReadonlySet<string> {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  return new Set(lines.filter((line) => line && !line.startsWith('#')));
}
