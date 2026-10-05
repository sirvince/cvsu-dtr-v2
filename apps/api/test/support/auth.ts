import type { INestApplication } from '@nestjs/common';
import type { Role } from '@cvsu-dtr/shared';
import request from 'supertest';
import type { App } from 'supertest/types';
import { UserAdminService } from '../../src/modules/auth/application/user-admin.service';

export const TEST_PASSWORD = 'Kape-at-Pandesal-2026!';
let counter = 0;

/** Creates a user with `roles`, logs in through the real endpoint, returns the Bearer header. */
export async function loginAs(
  app: INestApplication,
  roles: Role[],
): Promise<{ userId: string; authorization: string }> {
  const email = `test.user${++counter}.${Date.now()}@cvsu.edu.ph`;
  const { userId } = await app
    .get(UserAdminService)
    .setPassword({ email, password: TEST_PASSWORD, create: true, roles });
  const res = await request(app.getHttpServer() as App)
    .post('/api/v1/auth/login')
    // A distinct client IP per login keeps suites clear of the login rate limit.
    .set('X-Forwarded-For', `198.51.100.${counter % 250}`)
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  return {
    userId,
    authorization: `Bearer ${(res.body as { data: { accessToken: string } }).data.accessToken}`,
  };
}
