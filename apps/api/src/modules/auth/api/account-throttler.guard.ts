import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Per-account rate limit on login (SECURITY-PRIVACY §2). The global ThrottlerGuard already limits
 * per client IP; this one keys the same @Throttle() limit on the submitted email instead, so
 * spreading attempts over many IPs doesn't help either. Lockout still applies on top.
 */
@Injectable()
export class AccountThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const body = req.body as { email?: unknown } | undefined;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    return Promise.resolve(`account:${email}`);
  }
}
