import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import { getDataSourceToken } from '@nestjs/typeorm';
import { HealthController } from './health.controller';

async function controllerWith(query: () => Promise<unknown>) {
  const moduleRef = await Test.createTestingModule({
    imports: [TerminusModule.forRoot({ logger: false })],
    controllers: [HealthController],
    providers: [{ provide: getDataSourceToken(), useValue: { query } }],
  }).compile();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('liveness never touches the database', async () => {
    const query = jest.fn();
    const controller = await controllerWith(query);
    expect(controller.live()).toEqual({ status: 'ok' });
    expect(query).not.toHaveBeenCalled();
  });

  it('readiness is up when SELECT 1 succeeds', async () => {
    const controller = await controllerWith(() => Promise.resolve([{ '?column?': 1 }]));
    await expect(controller.ready()).resolves.toMatchObject({
      status: 'ok',
      info: { database: { status: 'up' } },
    });
  });

  it('readiness is 503 when the database is unreachable, without the driver message', async () => {
    const controller = await controllerWith(() =>
      Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432')),
    );
    const error = await controller.ready().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const body = (error as ServiceUnavailableException).getResponse();
    expect(body).toMatchObject({ error: { database: { status: 'down', message: 'unreachable' } } });
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
  });
});
