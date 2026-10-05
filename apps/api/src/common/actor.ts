import type { Role } from '@cvsu-dtr/shared';

/**
 * Who is acting. Built from the verified JWT (BE-004), never from the request body.
 * `null` where an actor is accepted means the system itself (jobs, automatic reconciliation).
 */
export interface Actor {
  userId: string;
  roles: readonly Role[];
}

/** Request metadata for the audit trail. */
export interface RequestContext {
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}
