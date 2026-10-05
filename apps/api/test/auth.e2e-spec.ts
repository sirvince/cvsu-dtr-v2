import { createHash } from 'node:crypto';
import { Controller, Get, Module } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Role } from '@cvsu-dtr/shared';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Roles } from '../src/common/auth/decorators';
import { CLOCK, FixedClock } from '../src/common/time/clock';
import { configureApp } from '../src/configure-app';
import { UserAdminService } from '../src/modules/auth/application/user-admin.service';
import { getDataSourceToken } from '@nestjs/typeorm';

const PASSWORD = 'Kape-at-Pandesal-2026!';

@Controller('probe-auth')
class RoleProbeController {
  @Get('hr-only')
  @Roles('HR_ADMIN')
  hrOnly() {
    return { ok: true };
  }
}

@Module({ controllers: [RoleProbeController] })
class RoleProbeModule {}

describe('Auth (e2e)', () => {
  let app: NestExpressApplication;
  let http: App;
  let db: DataSource;
  let users: UserAdminService;
  const clock = new FixedClock('2026-10-06T01:00:00Z');

  // Each scenario gets its own client IP and account, so per-IP / per-account limits don't collide.
  let nextIp = 1;
  const client = () => `203.0.113.${nextIp++}`;
  let nextUser = 1;
  const newUser = async (roles: Role[] = ['HR_ADMIN']) => {
    const email = `hr.user${nextUser++}@cvsu.edu.ph`;
    const { userId } = await users.setPassword({ email, password: PASSWORD, create: true, roles });
    return { email, userId };
  };

  const login = (email: string, password: string, ip = client()) =>
    request(http).post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email, password });
  const refresh = (cookie: string | undefined, ip = client()) => {
    const req = request(http).post('/api/v1/auth/refresh').set('X-Forwarded-For', ip);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const me = (token: string) =>
    request(http).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

  /** `refresh_token=<raw>` from a response, ready to send back as a Cookie header. */
  const refreshCookie = (res: request.Response): string => {
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const cookie = cookies.find((c) => c.startsWith('refresh_token='));
    if (!cookie) throw new Error('no refresh_token cookie in response');
    return cookie.split(';')[0]!;
  };
  const auditActions = async (userId: string) =>
    (
      await db.query<{ action: string }[]>(
        `SELECT action FROM audit_logs WHERE entity_type = 'user' AND entity_id = $1 ORDER BY id`,
        [userId],
      )
    ).map((r) => r.action);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, RoleProbeModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    db = app.get<DataSource>(getDataSourceToken());
    users = app.get(UserAdminService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('login', () => {
    it('returns an access token and sets a hardened refresh cookie', async () => {
      const { email, userId } = await newUser();
      const res = await login(email, PASSWORD).expect(200);

      expect(res.body.data).toEqual({
        accessToken: expect.stringMatching(/^ey/),
        expiresIn: 900,
        user: { id: userId, email, roles: ['HR_ADMIN'] },
      });
      expect(JSON.stringify(res.body)).not.toContain(refreshCookie(res).split('=')[1]);

      const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? [])[0]!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
      expect(cookie).toMatch(/Expires=/);
    });

    it('accepts the email in any case and with surrounding spaces', async () => {
      const { email } = await newUser();
      await login(`  ${email.toUpperCase()} `, PASSWORD).expect(200);
    });

    it('returns the same 401 AUTH_INVALID_CREDENTIALS for a wrong password and an unknown email', async () => {
      const { email } = await newUser();
      const wrong = await login(email, 'not-the-password-at-all').expect(401);
      const unknown = await login('nobody@cvsu.edu.ph', PASSWORD).expect(401);

      expect(wrong.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(unknown.body.error.code).toBe(wrong.body.error.code);
      expect(unknown.body.error.message).toBe(wrong.body.error.message);
      expect(unknown.headers['set-cookie']).toBeUndefined();
    });

    it('treats an inactive account like a wrong password', async () => {
      const { email, userId } = await newUser();
      await db.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [userId]);
      const res = await login(email, PASSWORD).expect(401);
      expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('writes AUTH_LOGIN to the audit log', async () => {
      const { email, userId } = await newUser();
      await login(email, PASSWORD).expect(200);
      expect(await auditActions(userId)).toContain('AUTH_LOGIN');
    });
  });

  describe('lockout (A1)', () => {
    it('5 wrong passwords lock the account; the 6th attempt fails even with the right password', async () => {
      const { email, userId } = await newUser();
      const ip = client();
      for (let attempt = 1; attempt <= 4; attempt++) {
        const res = await login(email, `wrong-password-${attempt}`, ip).expect(401);
        expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
      }
      const fifth = await login(email, 'wrong-password-5', ip).expect(401);
      expect(fifth.body.error.code).toBe('AUTH_ACCOUNT_LOCKED');

      const sixth = await login(email, PASSWORD, ip).expect(401);
      expect(sixth.body.error).toMatchObject({
        code: 'AUTH_ACCOUNT_LOCKED',
        details: { lockedUntil: '2026-10-06T01:15:00.000Z' },
      });

      expect(await auditActions(userId)).toEqual(
        expect.arrayContaining(['AUTH_LOGIN_FAILED', 'AUTH_ACCOUNT_LOCKED', 'AUTH_LOGIN_BLOCKED']),
      );
    });

    it('unlocks after 15 minutes and a successful login resets the counter', async () => {
      const { email, userId } = await newUser();
      for (let attempt = 1; attempt <= 5; attempt++) await login(email, 'wrong-password');
      await login(email, PASSWORD).expect(401);

      clock.advance({ minutes: 16 });
      await login(email, PASSWORD).expect(200);
      const [row] = await db.query<{ failed_login_count: number; locked_until: Date | null }[]>(
        `SELECT failed_login_count, locked_until FROM users WHERE id = $1`,
        [userId],
      );
      expect(row).toEqual({ failed_login_count: 0, locked_until: null });
    });
  });

  describe('access token', () => {
    it('GET /auth/me needs a valid Bearer token', async () => {
      const { email, userId } = await newUser();
      const token = (await login(email, PASSWORD).expect(200)).body.data.accessToken as string;

      const res = await me(token).expect(200);
      expect(res.body.data).toEqual({
        id: userId,
        email,
        roles: ['HR_ADMIN'],
        employee: null,
        scopes: [],
      });

      const none = await request(http).get('/api/v1/auth/me').expect(401);
      expect(none.body.error.code).toBe('UNAUTHENTICATED');
      await me('not.a.jwt').expect(401);
      await me(`${token.slice(0, -4)}AAAA`).expect(401); // bad signature
    });

    it('@Roles: 403 when the role is missing, 200 when present', async () => {
      const hr = await newUser(['HR_ADMIN']);
      const employee = await newUser(['EMPLOYEE']);
      const hrToken = (await login(hr.email, PASSWORD).expect(200)).body.data.accessToken as string;
      const empToken = (await login(employee.email, PASSWORD).expect(200)).body.data
        .accessToken as string;

      await request(http)
        .get('/api/v1/probe-auth/hr-only')
        .set('Authorization', `Bearer ${hrToken}`)
        .expect(200);
      const denied = await request(http)
        .get('/api/v1/probe-auth/hr-only')
        .set('Authorization', `Bearer ${empToken}`)
        .expect(403);
      expect(denied.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('refresh rotation', () => {
    it('rotates; replaying the old token returns AUTH_REFRESH_REUSED and revokes the new one too', async () => {
      const { email, userId } = await newUser();
      const first = refreshCookie(await login(email, PASSWORD).expect(200));

      const rotated = await refresh(first).expect(200);
      const second = refreshCookie(rotated);
      expect(second).not.toBe(first);
      expect(rotated.body.data.accessToken).toMatch(/^ey/);

      const replay = await refresh(first).expect(401);
      expect(replay.body.error.code).toBe('AUTH_REFRESH_REUSED');

      const afterReuse = await refresh(second).expect(401);
      expect(afterReuse.body.error.code).toBe('AUTH_TOKEN_EXPIRED');
      expect(await auditActions(userId)).toContain('AUTH_REFRESH_REUSED');
    });

    it('stores refresh tokens only as SHA-256 hashes', async () => {
      const { email, userId } = await newUser();
      const raw = refreshCookie(await login(email, PASSWORD).expect(200)).split('=')[1]!;
      const rows = await db.query<{ token_hash: string }[]>(
        `SELECT token_hash FROM refresh_tokens WHERE user_id = $1`,
        [userId],
      );
      expect(rows).toEqual([{ token_hash: createHash('sha256').update(raw).digest('hex') }]);
      expect(JSON.stringify(rows)).not.toContain(raw);
    });

    it('without a cookie → 401 AUTH_TOKEN_EXPIRED', async () => {
      const res = await refresh(undefined).expect(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_EXPIRED');
    });

    it('an expired refresh token is refused', async () => {
      const { email } = await newUser();
      const cookie = refreshCookie(await login(email, PASSWORD).expect(200));
      clock.advance({ hours: 8 * 24 }); // past the 7-day refresh TTL
      const res = await refresh(cookie).expect(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_EXPIRED');
    });
  });

  describe('change password', () => {
    it('validates the current and new password', async () => {
      const { email } = await newUser();
      const token = (await login(email, PASSWORD).expect(200)).body.data.accessToken as string;
      const change = (body: object) =>
        request(http)
          .post('/api/v1/auth/change-password')
          .set('Authorization', `Bearer ${token}`)
          .send(body);

      const wrong = await change({ currentPassword: 'nope', newPassword: 'Brand-New-Pass-2026' });
      expect(wrong.status).toBe(401);
      expect(wrong.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');

      const weak = await change({ currentPassword: PASSWORD, newPassword: 'short' }).expect(400);
      expect(weak.body.error.details).toEqual([
        { field: 'newPassword', message: 'Use at least 12 characters.' },
      ]);

      const same = await change({ currentPassword: PASSWORD, newPassword: PASSWORD }).expect(400);
      expect(same.body.error.details[0].field).toBe('newPassword');
    });

    it('bumps ver: the old access token gets 401, the old refresh token is revoked', async () => {
      const { email, userId } = await newUser();
      const loggedIn = await login(email, PASSWORD).expect(200);
      const oldToken = loggedIn.body.data.accessToken as string;
      const oldCookie = refreshCookie(loggedIn);
      const newPassword = 'Brand-New-Pass-2026';

      const changed = await request(http)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${oldToken}`)
        .send({ currentPassword: PASSWORD, newPassword })
        .expect(200);

      const stale = await me(oldToken).expect(401);
      expect(stale.body.error.code).toBe('AUTH_TOKEN_EXPIRED');
      await me(changed.body.data.accessToken as string).expect(200);
      await refresh(oldCookie).expect(401);
      await refresh(refreshCookie(changed)).expect(200);

      await login(email, PASSWORD).expect(401);
      await login(email, newPassword).expect(200);
      expect(await auditActions(userId)).toContain('AUTH_PASSWORD_CHANGED');
    });
  });

  describe('logout', () => {
    it('revokes the session, clears the cookie and is audited', async () => {
      const { email, userId } = await newUser();
      const cookie = refreshCookie(await login(email, PASSWORD).expect(200));

      const res = await request(http).post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
      expect(([] as string[]).concat(res.headers['set-cookie'] ?? [])[0]).toMatch(
        /^refresh_token=;.*Expires=Thu, 01 Jan 1970/,
      );
      await refresh(cookie).expect(401);
      expect(await auditActions(userId)).toEqual(
        expect.arrayContaining(['AUTH_LOGIN', 'AUTH_LOGOUT']),
      );

      // Idempotent: a second logout, or one without a cookie, still succeeds.
      await request(http).post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
      await request(http).post('/api/v1/auth/logout').expect(204);
    });

    it('logout-all ends every session, including issued access tokens', async () => {
      const { email } = await newUser();
      const a = await login(email, PASSWORD).expect(200);
      const b = await login(email, PASSWORD).expect(200);

      await request(http)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${a.body.data.accessToken as string}`)
        .expect(204);
      await refresh(refreshCookie(b)).expect(401);
      await me(b.body.data.accessToken as string).expect(401);
    });
  });

  describe('rate limits', () => {
    it('login is limited per client IP', async () => {
      const ip = client();
      for (let i = 0; i < 10; i++) await login(`nobody${i}@cvsu.edu.ph`, 'whatever-password', ip);
      const res = await login('nobody-else@cvsu.edu.ph', 'whatever-password', ip).expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    });

    it('login is limited per account, even across IPs', async () => {
      const { email } = await newUser();
      for (let i = 0; i < 10; i++) await login(email, PASSWORD).expect(200);
      await login(email, PASSWORD).expect(429);
    });
  });
});
