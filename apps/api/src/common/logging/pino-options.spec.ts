import { Writable } from 'node:stream';
import express from 'express';
import pinoHttp from 'pino-http';
import request from 'supertest';
import { buildPinoHttpOptions } from './pino-options';

/** Runs the real pino-http options against a tiny Express app and captures the log lines. */
function appWithCapturedLogs() {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const app = express();
  app.use(pinoHttp(buildPinoHttpOptions({ nodeEnv: 'test', logLevel: 'info' }), sink));
  app.get('/api/v1/things', (req, res) => {
    req.log.info({ body: { password: 'hunter2', refreshToken: 'rt-secret' } }, 'handled');
    res.cookie('refresh_token', 'cookie-secret').json({ ok: true });
  });
  return { app, lines };
}

describe('pino-http options', () => {
  it('never logs the Authorization header, cookies, passwords or tokens', async () => {
    const { app, lines } = appWithCapturedLogs();
    await request(app)
      .get('/api/v1/things')
      .set('Authorization', 'Bearer eyJ-access-secret')
      .set('Cookie', 'refresh_token=old-cookie-secret')
      .expect(200);

    const log = lines.join('\n');
    expect(log).toContain('[REDACTED]');
    for (const secret of [
      'eyJ-access-secret',
      'old-cookie-secret',
      'cookie-secret',
      'hunter2',
      'rt-secret',
    ]) {
      expect(log).not.toContain(secret);
    }
  });

  it('reuses a safe caller request ID and replaces an unsafe one', async () => {
    const { app } = appWithCapturedLogs();
    const kept = await request(app).get('/api/v1/things').set('X-Request-Id', 'abc-123');
    expect(kept.headers['x-request-id']).toBe('abc-123');

    for (const unsafe of ['has spaces', '<script>', 'x'.repeat(65)]) {
      const replaced = await request(app).get('/api/v1/things').set('X-Request-Id', unsafe);
      expect(replaced.headers['x-request-id']).toMatch(/^req_[0-9a-f]{32}$/);
    }
  });

  it('does not log health probes', async () => {
    const { app, lines } = appWithCapturedLogs();
    app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));
    await request(app).get('/api/v1/health').expect(200);
    expect(lines).toHaveLength(0);
  });
});
