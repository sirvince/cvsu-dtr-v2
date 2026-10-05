import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Role } from '@cvsu-dtr/shared';
import { type DataSource, type EntityManager, IsNull } from 'typeorm';
import type { Actor, RequestContext } from '../../../common/actor';
import { SessionExpiredError } from '../../../common/auth/errors';
import { ValidationFailedError } from '../../../common/domain/domain-error';
import { CLOCK, type Clock } from '../../../common/time/clock';
import { AppConfig } from '../../../config/app-config';
import { AuditService } from '../../audit/audit.service';
import {
  AccountLockedError,
  InvalidCredentialsError,
  RefreshReusedError,
} from '../domain/auth-errors';
import { lockMinutesAfter } from '../domain/lockout';
import { checkPassword } from '../domain/password-policy';
import { BREACHED_PASSWORDS } from '../infrastructure/breached-passwords';
import {
  RefreshTokenEntity,
  UserDepartmentScopeEntity,
  UserEntity,
  UserRoleEntity,
} from '../infrastructure/entities';
import { PasswordHasher } from '../infrastructure/password-hasher';
import { hashRefreshToken, newRefreshToken } from '../infrastructure/refresh-token';

/** JWT claims (SECURITY-PRIVACY §2). */
export interface AccessTokenClaims {
  sub: string;
  roles: Role[];
  ver: number;
}

export interface SessionUser {
  id: string;
  email: string;
  roles: Role[];
}

export interface Session {
  accessToken: string;
  expiresIn: number;
  user: SessionUser;
  /** Raw refresh token: goes into the cookie only, never into a response body or log. */
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface Me {
  id: string;
  email: string;
  roles: Role[];
  employee: { id: string; name: string; departmentId: string } | null;
  scopes: string[];
}

/**
 * A transaction's result. Failures that must still be persisted (failed-attempt counter,
 * lockout, family revocation, audit rows) are returned and thrown only after commit.
 */
type Outcome<T> = { ok: true; value: T } | { ok: false; error: Error };
const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });
const fail = <T>(error: Error): Outcome<T> => ({ ok: false, error });
const unwrap = <T>(outcome: Outcome<T>): T => {
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
};

@Injectable()
export class AuthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BREACHED_PASSWORDS) private readonly breached: ReadonlySet<string>,
  ) {}

  async login(email: string, password: string, ctx: RequestContext): Promise<Session> {
    const outcome = await this.dataSource.transaction(async (tx): Promise<Outcome<Session>> => {
      const users = tx.getRepository(UserEntity);
      const user = await users.findOne({ where: { email }, lock: { mode: 'pessimistic_write' } });
      const now = this.now();

      if (!user || user.status !== 'ACTIVE') {
        await this.hasher.verifyDummy(password); // same timing as a real check
        await this.audit.record(tx, {
          ...ctx,
          actor: null,
          action: 'AUTH_LOGIN_FAILED',
          entityType: 'user',
          entityId: user?.id ?? null,
          metadata: { reason: user ? `STATUS_${user.status}` : 'UNKNOWN_EMAIL' },
        });
        return fail(new InvalidCredentialsError());
      }

      if (user.lockedUntil && user.lockedUntil > now) {
        await this.audit.record(tx, {
          ...ctx,
          actor: null,
          action: 'AUTH_LOGIN_BLOCKED',
          entityType: 'user',
          entityId: user.id,
          metadata: { lockedUntil: user.lockedUntil.toISOString() },
        });
        return fail(new AccountLockedError(user.lockedUntil));
      }

      if (!(await this.hasher.verify(user.passwordHash, password))) {
        user.failedLoginCount += 1;
        const lockMinutes = lockMinutesAfter(user.failedLoginCount);
        user.lockedUntil = lockMinutes ? this.now(lockMinutes) : null;
        await users.save(user);
        await this.audit.record(tx, {
          ...ctx,
          actor: null,
          action: lockMinutes ? 'AUTH_ACCOUNT_LOCKED' : 'AUTH_LOGIN_FAILED',
          entityType: 'user',
          entityId: user.id,
          metadata: {
            reason: 'WRONG_PASSWORD',
            failedLoginCount: user.failedLoginCount,
            lockMinutes,
          },
        });
        return fail(
          user.lockedUntil
            ? new AccountLockedError(user.lockedUntil)
            : new InvalidCredentialsError(),
        );
      }

      user.failedLoginCount = 0;
      user.lockedUntil = null;
      user.lastLoginAt = now;
      if (user.passwordHash && this.hasher.needsRehash(user.passwordHash)) {
        user.passwordHash = await this.hasher.hash(password);
      }
      await users.save(user);
      const roles = await this.rolesOf(tx, user.id);
      const { session } = await this.startSession(tx, user, roles, ctx);
      await this.audit.record(tx, {
        ...ctx,
        actor: { userId: user.id, roles },
        action: 'AUTH_LOGIN',
        entityType: 'user',
        entityId: user.id,
      });
      return ok(session);
    });
    return unwrap(outcome);
  }

  /** Rotates the refresh token. Presenting a rotated token again revokes the whole family. */
  async refresh(rawToken: string, ctx: RequestContext): Promise<Session> {
    const outcome = await this.dataSource.transaction(async (tx): Promise<Outcome<Session>> => {
      const tokens = tx.getRepository(RefreshTokenEntity);
      const token = await tokens.findOne({
        where: { tokenHash: hashRefreshToken(rawToken) },
        lock: { mode: 'pessimistic_write' },
      });
      const now = this.now();
      if (!token) return fail(new SessionExpiredError());

      if (token.replacedBy) {
        await this.revokeFamily(tx, token.familyId, now);
        await this.audit.record(tx, {
          ...ctx,
          actor: null,
          action: 'AUTH_REFRESH_REUSED',
          entityType: 'user',
          entityId: token.userId,
          metadata: { familyId: token.familyId },
        });
        return fail(new RefreshReusedError());
      }
      if (token.revokedAt || token.expiresAt <= now) return fail(new SessionExpiredError());

      const user = await tx.getRepository(UserEntity).findOneBy({ id: token.userId });
      if (!user || user.status !== 'ACTIVE') {
        await this.revokeFamily(tx, token.familyId, now);
        return fail(new SessionExpiredError());
      }

      const roles = await this.rolesOf(tx, user.id);
      const next = await this.startSession(tx, user, roles, ctx, token.familyId);
      token.revokedAt = now;
      token.replacedBy = next.tokenId;
      await tokens.save(token);
      return ok(next.session);
    });
    return unwrap(outcome);
  }

  /** Ends the session of this refresh token. Idempotent: an unknown or revoked token is a no-op. */
  async logout(rawToken: string | undefined, ctx: RequestContext): Promise<void> {
    if (!rawToken) return;
    await this.dataSource.transaction(async (tx) => {
      const tokens = tx.getRepository(RefreshTokenEntity);
      const token = await tokens.findOneBy({ tokenHash: hashRefreshToken(rawToken) });
      if (!token || token.revokedAt) return;
      token.revokedAt = this.now();
      await tokens.save(token);
      await this.audit.record(tx, {
        ...ctx,
        actor: { userId: token.userId, roles: await this.rolesOf(tx, token.userId) },
        action: 'AUTH_LOGOUT',
        entityType: 'user',
        entityId: token.userId,
      });
    });
  }

  /** Ends every session of the user, including access tokens (via `ver`). */
  async logoutAll(actor: Actor, ctx: RequestContext): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      await this.revokeAllSessions(tx, actor.userId);
      await tx.getRepository(UserEntity).increment({ id: actor.userId }, 'tokenVersion', 1);
      await this.audit.record(tx, {
        ...ctx,
        actor,
        action: 'AUTH_LOGOUT_ALL',
        entityType: 'user',
        entityId: actor.userId,
      });
    });
  }

  /**
   * Bumps `ver` and ends every other session, then starts a fresh one so the caller stays
   * logged in on this device.
   */
  async changePassword(
    actor: Actor,
    currentPassword: string,
    newPassword: string,
    ctx: RequestContext,
  ): Promise<Session> {
    const outcome = await this.dataSource.transaction(async (tx): Promise<Outcome<Session>> => {
      const users = tx.getRepository(UserEntity);
      const user = await users.findOne({
        where: { id: actor.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || user.status !== 'ACTIVE') return fail(new SessionExpiredError());

      if (!(await this.hasher.verify(user.passwordHash, currentPassword))) {
        await this.audit.record(tx, {
          ...ctx,
          actor,
          action: 'AUTH_PASSWORD_CHANGE_FAILED',
          entityType: 'user',
          entityId: user.id,
          metadata: { reason: 'WRONG_CURRENT_PASSWORD' },
        });
        return fail(new InvalidCredentialsError());
      }

      const problems = checkPassword(newPassword, { email: user.email, breached: this.breached });
      if (await this.hasher.verify(user.passwordHash, newPassword)) {
        problems.push({
          field: 'newPassword',
          message: 'Choose a password you are not using now.',
        });
      }
      if (problems.length) return fail(new ValidationFailedError(problems));

      const now = this.now();
      user.passwordHash = await this.hasher.hash(newPassword);
      user.passwordChangedAt = now;
      user.tokenVersion += 1;
      await users.save(user);
      await this.revokeAllSessions(tx, user.id);
      const { session } = await this.startSession(tx, user, [...actor.roles], ctx);
      await this.audit.record(tx, {
        ...ctx,
        actor,
        action: 'AUTH_PASSWORD_CHANGED',
        entityType: 'user',
        entityId: user.id,
      });
      return ok(session);
    });
    return unwrap(outcome);
  }

  async me(actor: Actor): Promise<Me> {
    const user = await this.dataSource.getRepository(UserEntity).findOneBy({ id: actor.userId });
    if (!user) throw new SessionExpiredError();
    const scopes = await this.dataSource
      .getRepository(UserDepartmentScopeEntity)
      .findBy({ userId: user.id });
    return {
      id: user.id,
      email: user.email,
      roles: [...actor.roles],
      // Linked employee records arrive with the employees module (BE-005); Phase 1 HR has none.
      employee: null,
      scopes: scopes.map((s) => s.departmentId),
    };
  }

  /** Called by the JWT strategy on every request: the token must match the user's current `ver`. */
  async actorFor(claims: AccessTokenClaims): Promise<Actor> {
    const user = await this.dataSource.getRepository(UserEntity).findOneBy({ id: claims.sub });
    if (!user || user.status !== 'ACTIVE' || user.tokenVersion !== claims.ver) {
      throw new SessionExpiredError();
    }
    return { userId: user.id, roles: await this.rolesOf(this.dataSource.manager, user.id) };
  }

  private async startSession(
    tx: EntityManager,
    user: UserEntity,
    roles: Role[],
    ctx: RequestContext,
    familyId: string = randomUUID(),
  ): Promise<{ session: Session; tokenId: string }> {
    const { raw, hash } = newRefreshToken();
    const refreshExpiresAt = this.now(this.config.get('REFRESH_TOKEN_TTL_DAYS') * 24 * 60);
    const tokens = tx.getRepository(RefreshTokenEntity);
    const saved = await tokens.save(
      tokens.create({
        userId: user.id,
        familyId,
        tokenHash: hash,
        expiresAt: refreshExpiresAt,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      }),
    );
    const claims: AccessTokenClaims = { sub: user.id, roles, ver: user.tokenVersion };
    return {
      tokenId: saved.id,
      session: {
        accessToken: await this.jwt.signAsync(claims),
        expiresIn: this.config.get('JWT_ACCESS_TTL'),
        user: { id: user.id, email: user.email, roles },
        refreshToken: raw,
        refreshExpiresAt,
      },
    };
  }

  private async rolesOf(tx: EntityManager, userId: string): Promise<Role[]> {
    const rows = await tx.getRepository(UserRoleEntity).find({
      where: { userId },
      order: { role: 'ASC' },
    });
    return rows.map((r) => r.role);
  }

  private async revokeFamily(tx: EntityManager, familyId: string, now: Date): Promise<void> {
    await tx
      .getRepository(RefreshTokenEntity)
      .update({ familyId, revokedAt: IsNull() }, { revokedAt: now });
  }

  private async revokeAllSessions(tx: EntityManager, userId: string): Promise<void> {
    await tx
      .getRepository(RefreshTokenEntity)
      .update({ userId, revokedAt: IsNull() }, { revokedAt: this.now() });
  }

  /** Now (plus `minutes`), from the injected Clock so tests can pin time. */
  private now(minutes = 0): Date {
    return new Date(this.clock.now().add({ minutes }).epochMilliseconds);
  }
}
