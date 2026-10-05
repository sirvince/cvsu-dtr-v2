/** SECURITY-PRIVACY §2: 5 failed attempts lock the account for 15 minutes, progressively longer. */
export const MAX_FAILED_ATTEMPTS = 5;
const BASE_LOCK_MINUTES = 15;
const MAX_LOCK_MINUTES = 24 * 60;

/**
 * Minutes to lock after the failure that brought the count to `failedCount`, or null for no lock.
 * Locks at every 5th consecutive failure: 15, 30, 60 … minutes, capped at 24 h.
 * A successful login resets the count to 0.
 */
export function lockMinutesAfter(failedCount: number): number | null {
  if (failedCount < MAX_FAILED_ATTEMPTS || failedCount % MAX_FAILED_ATTEMPTS !== 0) return null;
  const lockNumber = failedCount / MAX_FAILED_ATTEMPTS;
  return Math.min(BASE_LOCK_MINUTES * 2 ** (lockNumber - 1), MAX_LOCK_MINUTES);
}
