import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Role } from '@cvsu-dtr/shared';
import { ForbiddenError, SessionExpiredError, UnauthenticatedError } from './errors';
import { actorOf, IS_PUBLIC, ROLES } from './decorators';

/**
 * Global: every route needs a valid Bearer access token unless it is @Public().
 * The strategy (modules/auth) also rejects tokens whose `ver` is stale.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    return isPublic ? true : super.canActivate(context);
  }

  override handleRequest<T>(err: unknown, user: T | false, info: unknown): T {
    if (err) throw err instanceof Error ? err : new UnauthenticatedError();
    if (user) return user;
    // An expired token gets AUTH_TOKEN_EXPIRED so the web client knows to call /auth/refresh.
    if (info instanceof Error && info.name === 'TokenExpiredError') throw new SessionExpiredError();
    throw new UnauthenticatedError();
  }
}

/** Global: enforces @Roles(). Routes without @Roles only need authentication. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const actor = actorOf(context);
    if (actor && required.some((role) => actor.roles.includes(role))) return true;
    throw new ForbiddenError();
  }
}
