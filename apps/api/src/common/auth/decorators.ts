import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@cvsu-dtr/shared';
import type { Actor } from '../actor';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Opts a route out of the global JwtAuthGuard. Every other route requires a valid access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The actor needs at least one of these roles (union of the user's roles), else 403. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/**
 * The authenticated actor, from the verified access token. Never trust an id from the
 * path or body for "who is acting" (SECURITY-PRIVACY §3).
 */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const actor = actorOf(ctx);
  if (!actor) throw new Error('@CurrentActor() used on a route without authentication');
  return actor;
});

/** The actor JwtStrategy put on the request (passport types `req.user` loosely). */
export function actorOf(ctx: ExecutionContext): Actor | undefined {
  return ctx.switchToHttp().getRequest<{ user?: Actor }>().user;
}
