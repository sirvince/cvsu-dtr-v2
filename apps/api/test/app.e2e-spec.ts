import { Body, Controller, Get, Module, Post, Query } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsInt, IsString, Matches, Min, ValidateNested } from 'class-validator';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { Public } from '../src/common/auth/decorators';
import { DomainError } from '../src/common/domain/domain-error';
import { Paginated, PaginationQueryDto } from '../src/common/http/paginated';
import { configureApp } from '../src/configure-app';

class BlockDto {
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:mm' })
  startTime!: string;
}

class CreateThingDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(1)
  count!: number;

  @ValidateNested({ each: true })
  @Type(() => BlockDto)
  blocks!: BlockDto[];
}

/** Test-only routes that exercise the global pipeline. */
@Public()
@Controller('probe')
class ProbeController {
  @Get('thing')
  thing() {
    return { id: 'abc', name: 'A thing' };
  }

  @Get('list')
  list(@Query() query: PaginationQueryDto) {
    return new Paginated([{ id: 1 }, { id: 2 }], 45, query.page, query.limit);
  }

  @Post('things')
  create(@Body() dto: CreateThingDto) {
    return dto;
  }

  @Get('domain-error')
  domainError() {
    throw new DomainError('MAKER_CHECKER_VIOLATION', 'Approver must differ from requester.', {
      details: { level: 'APPROVE' },
    });
  }

  @Get('boom')
  boom() {
    throw new Error('secret internal detail: connection to 10.0.0.5 refused');
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('API foundation (e2e)', () => {
  let app: NestExpressApplication;
  let http: App;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ProbeModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('success envelope', () => {
    it('wraps a resource in { data }', async () => {
      const res = await request(http).get('/api/v1/probe/thing').expect(200);
      expect(res.body).toEqual({ data: { id: 'abc', name: 'A thing' } });
    });

    it('wraps a list in { data, meta }', async () => {
      const res = await request(http).get('/api/v1/probe/list?page=2&limit=20').expect(200);
      expect(res.body).toEqual({
        data: [{ id: 1 }, { id: 2 }],
        meta: { page: 2, limit: 20, total: 45, totalPages: 3 },
      });
    });

    it('enforces limit ≤ 100', async () => {
      const res = await request(http).get('/api/v1/probe/list?limit=101').expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual([{ field: 'limit', message: expect.any(String) }]);
    });
  });

  describe('error envelope', () => {
    it('unknown route → 404 with requestId', async () => {
      const res = await request(http).get('/api/v1/does-not-exist').expect(404);
      expect(res.body).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found.',
          details: null,
          requestId: res.headers['x-request-id'],
          timestamp: expect.any(String),
        },
      });
      expect(res.body.error.requestId).toMatch(/^req_/);
    });

    it('echoes a caller-supplied X-Request-Id', async () => {
      const res = await request(http)
        .get('/api/v1/nope')
        .set('X-Request-Id', 'support-42')
        .expect(404);
      expect(res.headers['x-request-id']).toBe('support-42');
      expect(res.body.error.requestId).toBe('support-42');
    });

    it('an extra field → 400 VALIDATION_ERROR with details[]', async () => {
      const res = await request(http)
        .post('/api/v1/probe/things')
        .send({ name: 'x', count: 1, blocks: [], isAdmin: true })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual([
        { field: 'isAdmin', message: 'property isAdmin should not exist' },
      ]);
    });

    it('reports nested field paths', async () => {
      const res = await request(http)
        .post('/api/v1/probe/things')
        .send({ name: 'x', count: 0, blocks: [{ startTime: '7:00' }] })
        .expect(400);
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([
          { field: 'count', message: expect.stringContaining('count') },
          { field: 'blocks.0.startTime', message: 'startTime must be HH:mm' },
        ]),
      );
    });

    it('a DomainError → its code and status 422', async () => {
      const res = await request(http).get('/api/v1/probe/domain-error').expect(422);
      expect(res.body.error).toMatchObject({
        code: 'MAKER_CHECKER_VIOLATION',
        message: 'Approver must differ from requester.',
        details: { level: 'APPROVE' },
      });
    });

    it('an unexpected error → 500 with a generic message and no internals', async () => {
      const res = await request(http).get('/api/v1/probe/boom').expect(500);
      expect(res.body.error).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/10\.0\.0\.5|stack|at .*\.ts/);
    });

    it('malformed JSON → 400 with a requestId', async () => {
      const res = await request(http)
        .post('/api/v1/probe/things')
        .set('Content-Type', 'application/json')
        .send('{bad')
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.requestId).toMatch(/^req_/);
    });

    it('a JSON body over 1 MB → 413', async () => {
      const res = await request(http)
        .post('/api/v1/probe/things')
        .send({ name: 'x'.repeat(1_100_000) })
        .expect(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('health', () => {
    it('liveness answers without the database', async () => {
      const res = await request(http).get('/api/v1/health').expect(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('readiness reports the database up (connected as app_user)', async () => {
      const res = await request(http).get('/api/v1/health/ready').expect(200);
      expect(res.body).toMatchObject({ status: 'ok', info: { database: { status: 'up' } } });
    });
  });

  describe('HTTP hardening', () => {
    it('sends the strict CSP and no X-Powered-By', async () => {
      const res = await request(http).get('/api/v1/health');
      expect(res.headers['content-security-policy']).toBe(
        "default-src 'self';frame-ancestors 'none'",
      );
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('allows CORS only for WEB_ORIGIN, with credentials only on /auth/*', async () => {
      const preflight = (path: string, origin: string) =>
        request(http)
          .options(path)
          .set('Origin', origin)
          .set('Access-Control-Request-Method', 'POST');

      const evil = await preflight('/api/v1/probe/things', 'https://evil.example');
      expect(evil.headers['access-control-allow-origin']).not.toBe('https://evil.example');

      const web = await preflight('/api/v1/probe/things', 'http://localhost:5173');
      expect(web.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(web.headers['access-control-allow-credentials']).toBeUndefined();

      const auth = await preflight('/api/v1/auth/login', 'http://localhost:5173');
      expect(auth.headers['access-control-allow-credentials']).toBe('true');
    });

    it('serves Swagger outside production', async () => {
      await request(http).get('/api/docs').expect(200);
    });
  });
});
