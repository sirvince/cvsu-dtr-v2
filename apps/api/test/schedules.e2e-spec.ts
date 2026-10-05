import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { LocalDate } from '../src/common/time/local-date';
import { configureApp } from '../src/configure-app';
import { SchedulesService } from '../src/modules/schedules/application/schedules.service';
import { loginAs } from './support/auth';

/** First date on or after `from` with ISO weekday `day` (1 = Monday). */
const nextWeekday = (from: string, day: number) => {
  let d = LocalDate.parse(from);
  while (d.dayOfWeek !== day) d = d.addDays(1);
  return d.toString();
};

const SEMESTER = { start: '2030-08-01', end: '2030-12-20' };
const FACULTY_MONDAY = [
  { dayOfWeek: 1, startTime: '07:00', endTime: '10:00' },
  { dayOfWeek: 1, startTime: '10:00', endTime: '12:00' },
  { dayOfWeek: 1, startTime: '14:00', endTime: '16:00' },
  { dayOfWeek: 1, startTime: '16:00', endTime: '19:00' },
];

describe('Schedules (e2e)', () => {
  let app: NestExpressApplication;
  let http: App;
  let db: DataSource;
  let auth: string;
  let templateId: string;
  let schedules: SchedulesService;
  let n = 0;

  const api = {
    get: (path: string) => request(http).get(`/api/v1${path}`).set('Authorization', auth),
    post: (path: string, body?: object) =>
      request(http).post(`/api/v1${path}`).set('Authorization', auth).send(body),
    put: (path: string, body: object, ifMatch?: string) => {
      const req = request(http).put(`/api/v1${path}`).set('Authorization', auth);
      return (ifMatch === undefined ? req : req.set('If-Match', ifMatch)).send(body);
    },
  };
  const newDepartment = async () =>
    (
      (await api.post('/departments', { code: `SCH${++n}`, name: `Schedules ${n}` }).expect(201))
        .body.data as { id: string }
    ).id;
  const newEmployee = async (departmentId: string) =>
    (
      (
        await api
          .post('/employees', {
            employeeNumber: `S-${String(++n).padStart(4, '0')}`,
            firstName: 'Maria',
            lastName: `Santos${n}`,
            departmentId,
            category: 'FACULTY',
            employmentType: 'PERMANENT',
          })
          .expect(201)
      ).body.data as { id: string }
    ).id;
  const assign = (body: object) =>
    api.post('/schedules/assign', {
      templateId,
      effectiveFrom: SEMESTER.start,
      effectiveTo: SEMESTER.end,
      ...body,
    });
  const approvedOn = async (employeeId: string, date: string) =>
    db.query<{ id: string }[]>(
      `SELECT id FROM employee_schedules WHERE employee_id = $1 AND status = 'APPROVED'
         AND effective_from <= $2 AND effective_to >= $2`,
      [employeeId, date],
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    db = app.get<DataSource>(getDataSourceToken());
    schedules = app.get(SchedulesService);
    templateId = await schedules.ensureDefaultTemplate();
    auth = (await loginAs(app, ['HR_ADMIN'])).authorization;

    const year = (
      await api
        .post('/academic-years', {
          code: '2030-2031',
          startDate: '2030-08-01',
          endDate: '2031-07-31',
        })
        .expect(201)
    ).body.data as { id: string };
    await api
      .post(`/academic-years/${year.id}/semesters`, {
        code: 'FIRST',
        startDate: SEMESTER.start,
        endDate: SEMESTER.end,
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the seeded "Regular 8–5" template', async () => {
    const res = await api.get('/schedule-templates').expect(200);
    const regular = (res.body.data as { name: string; blocks: unknown[] }[]).find(
      (t) => t.name === 'Regular 8–5',
    );
    expect(regular?.blocks).toHaveLength(10);
  });

  describe('POST /schedules/assign', () => {
    it('assigning a department creates one APPROVED schedule per active employee', async () => {
      const dept = await newDepartment();
      const employees = [await newEmployee(dept), await newEmployee(dept), await newEmployee(dept)];
      const inactive = await newEmployee(dept);
      await api.post(`/employees/${inactive}/deactivate`, { reason: 'Left' }).expect(200);

      const res = await assign({ departmentId: dept }).expect(201);
      expect(res.body.data).toMatchObject({ created: 3, superseded: 0, skipped: [] });

      const monday = nextWeekday(SEMESTER.start, 1);
      for (const id of employees) {
        const day = await schedules.approvedFor(id, monday);
        expect(day?.am && `${day.am.start.toString()}–${day.am.end.toString()}`).toBe(
          '08:00–12:00',
        );
        expect(day?.pm && `${day.pm.start.toString()}–${day.pm.end.toString()}`).toBe(
          '13:00–17:00',
        );
        expect(day?.scheduledMinutes).toBe(480);
      }
      expect(await approvedOn(inactive, monday)).toEqual([]);

      const [list] = (await api.get(`/employees/${employees[0]}/schedules`).expect(200)).body
        .data as {
        status: string;
        approvedDirectly: boolean;
        version: number;
        blocks: unknown[];
      }[];
      expect(list).toMatchObject({ status: 'APPROVED', approvedDirectly: true, version: 1 });
      expect(list?.blocks).toHaveLength(10);
    });

    it('re-assigning the same schedule is a no-op; a later start supersedes, never two approved per date', async () => {
      const dept = await newDepartment();
      const [a, b] = [await newEmployee(dept), await newEmployee(dept)];
      await assign({ departmentId: dept }).expect(201);

      const again = await assign({ departmentId: dept }).expect(201);
      expect(again.body.data).toMatchObject({ created: 0, superseded: 0 });
      expect(again.body.data.skipped).toEqual([
        { employeeId: expect.any(String), reason: 'ALREADY_ASSIGNED' },
        { employeeId: expect.any(String), reason: 'ALREADY_ASSIGNED' },
      ]);

      const later = await assign({ departmentId: dept, effectiveFrom: '2030-10-01' }).expect(201);
      expect(later.body.data).toMatchObject({ created: 2, superseded: 2 });

      const history = (await api.get(`/employees/${a}/schedules`).expect(200)).body.data as {
        effectiveFrom: string;
        effectiveTo: string;
        status: string;
        version: number;
      }[];
      expect(history.map((s) => [s.effectiveFrom, s.effectiveTo, s.status, s.version])).toEqual([
        ['2030-10-01', SEMESTER.end, 'APPROVED', 2],
        [SEMESTER.start, '2030-09-30', 'APPROVED', 1],
      ]);
      for (const date of ['2030-09-30', '2030-10-01', SEMESTER.end]) {
        expect(await approvedOn(b, date)).toHaveLength(1);
      }

      // A new first version (Aug 1–Sep 15) supersedes only the version it overlaps;
      // the Oct 1 version starts after it ends and stays approved.
      const reset = await assign({
        departmentId: dept,
        effectiveFrom: SEMESTER.start,
        effectiveTo: '2030-09-15',
      }).expect(201);
      expect(reset.body.data).toMatchObject({ created: 2, superseded: 2 });
      const statuses = (
        (await api.get(`/employees/${a}/schedules`).expect(200)).body.data as { status: string }[]
      ).map((s) => s.status);
      expect(statuses.sort()).toEqual(['APPROVED', 'APPROVED', 'SUPERSEDED']);
    });

    it('reports unknown and inactive employees in skipped', async () => {
      const dept = await newDepartment();
      const active = await newEmployee(dept);
      const inactive = await newEmployee(dept);
      await api.post(`/employees/${inactive}/deactivate`, { reason: 'Left' }).expect(200);
      const unknown = '00000000-0000-4000-8000-000000000000';

      const res = await assign({ employeeIds: [active, inactive, unknown] }).expect(201);
      expect(res.body.data.created).toBe(1);
      expect(res.body.data.skipped).toEqual([
        { employeeId: inactive, reason: 'INACTIVE' },
        { employeeId: unknown, reason: 'NOT_FOUND' },
      ]);
    });

    it('validates the request', async () => {
      const dept = await newDepartment();
      const emp = await newEmployee(dept);
      expect((await assign({}).expect(400)).body.error.details[0].field).toBe('departmentId');
      expect(
        (await assign({ departmentId: dept, employeeIds: [emp] }).expect(400)).body.error.details[0]
          .field,
      ).toBe('departmentId');
      expect(
        (
          await assign({
            departmentId: dept,
            templateId: '00000000-0000-4000-8000-000000000000',
          }).expect(400)
        ).body.error.details[0].field,
      ).toBe('templateId');
      expect(
        (await assign({ departmentId: dept, effectiveTo: '2030-12-31' }).expect(400)).body.error
          .details[0].field,
      ).toBe('effectiveTo');
      expect(
        (
          await assign({
            departmentId: dept,
            effectiveFrom: '2040-01-01',
            effectiveTo: '2040-02-01',
          }).expect(400)
        ).body.error.details[0].field,
      ).toBe('effectiveFrom');
    });

    it('HR_STAFF cannot assign', async () => {
      const staff = await loginAs(app, ['HR_STAFF']);
      await request(http)
        .post('/api/v1/schedules/assign')
        .set('Authorization', staff.authorization)
        .send({})
        .expect(403);
    });
  });

  describe('per-employee blocks (faculty, ADR-32)', () => {
    it('saves 4 Monday blocks: AM 07:00–12:00, PM 14:00–19:00, boundary 13:00, 600 min', async () => {
      const emp = await newEmployee(await newDepartment());
      const res = await api
        .post(`/employees/${emp}/schedules`, {
          effectiveFrom: SEMESTER.start,
          effectiveTo: SEMESTER.end,
          blocks: FACULTY_MONDAY,
        })
        .expect(201);
      expect(
        res.body.data.blocks.map((b: { blockNo: number; startTime: string }) => [
          b.blockNo,
          b.startTime,
        ]),
      ).toEqual([
        [1, '07:00'],
        [2, '10:00'],
        [3, '14:00'],
        [4, '16:00'],
      ]);

      const monday = await schedules.approvedFor(emp, nextWeekday(SEMESTER.start, 1));
      expect(monday).toMatchObject({ scheduledMinutes: 600 });
      expect(monday?.am?.start.toString()).toBe('07:00');
      expect(monday?.am?.end.toString()).toBe('12:00');
      expect(monday?.pm?.start.toString()).toBe('14:00');
      expect(monday?.pm?.end.toString()).toBe('19:00');
      expect(monday?.noonBoundary.toString()).toBe('13:00');

      const tuesday = await schedules.approvedFor(emp, nextWeekday(SEMESTER.start, 2));
      expect(tuesday).toMatchObject({ am: null, pm: null, scheduledMinutes: 0 }); // rest day
      expect(await schedules.approvedFor(emp, '2031-01-06')).toBeNull(); // no schedule → NO_SCHEDULE

      const [audit] = await db.query<{ metadata: { approval: string } }[]>(
        `SELECT metadata FROM audit_logs WHERE entity_id = $1 AND action = 'SCHEDULE_CREATED'`,
        [res.body.data.id],
      );
      expect(audit?.metadata.approval).toBe('DIRECT_HR');
    });

    it('overlapping blocks → 422 SCHEDULE_OVERLAP; a start-after-end block → 422 SCHEDULE_INVALID_BLOCK', async () => {
      const emp = await newEmployee(await newDepartment());
      const create = (blocks: object[]) =>
        api.post(`/employees/${emp}/schedules`, {
          effectiveFrom: SEMESTER.start,
          effectiveTo: SEMESTER.end,
          blocks,
        });

      const overlap = await create([
        { dayOfWeek: 1, startTime: '07:00', endTime: '10:00' },
        { dayOfWeek: 1, startTime: '09:00', endTime: '11:00' },
      ]).expect(422);
      expect(overlap.body.error).toMatchObject({
        code: 'SCHEDULE_OVERLAP',
        details: { dayOfWeek: 1, blocks: ['07:00–10:00', '09:00–11:00'] },
      });
      expect(
        (await create([{ dayOfWeek: 1, startTime: '12:00', endTime: '08:00' }]).expect(422)).body
          .error.code,
      ).toBe('SCHEDULE_INVALID_BLOCK');
      await create([{ dayOfWeek: 8, startTime: '08:00', endTime: '12:00' }]).expect(400);
      expect(await approvedOn(emp, SEMESTER.start)).toEqual([]); // nothing saved
    });

    it('an inactive employee gets 422 EMPLOYEE_INACTIVE', async () => {
      const emp = await newEmployee(await newDepartment());
      await api.post(`/employees/${emp}/deactivate`, { reason: 'Left' }).expect(200);
      const res = await api
        .post(`/employees/${emp}/schedules`, {
          effectiveFrom: SEMESTER.start,
          effectiveTo: SEMESTER.end,
          blocks: FACULTY_MONDAY,
        })
        .expect(422);
      expect(res.body.error.code).toBe('EMPLOYEE_INACTIVE');
    });

    it('PUT replaces the blocks, guarded by If-Match: rowVersion', async () => {
      const emp = await newEmployee(await newDepartment());
      const created = (
        await api
          .post(`/employees/${emp}/schedules`, {
            effectiveFrom: SEMESTER.start,
            effectiveTo: SEMESTER.end,
            blocks: FACULTY_MONDAY,
          })
          .expect(201)
      ).body.data as { id: string; rowVersion: number; version: number };
      const path = `/employees/${emp}/schedules/${created.id}`;
      const blocks = [{ dayOfWeek: 2, startTime: '08:00', endTime: '12:00' }];

      expect((await api.put(path, { blocks }).expect(400)).body.error.details[0].field).toBe(
        'If-Match',
      );
      const stale = await api.put(path, { blocks }, String(created.rowVersion + 5)).expect(409);
      expect(stale.body.error.code).toBe('CONCURRENT_MODIFICATION');

      const replaced = await api.put(path, { blocks }, `"${created.rowVersion}"`).expect(200);
      expect(replaced.body.data).toMatchObject({
        version: created.version + 1,
        rowVersion: created.rowVersion + 1,
        blocks: [{ dayOfWeek: 2, blockNo: 1, startTime: '08:00', endTime: '12:00' }],
      });
      // The old rowVersion no longer matches.
      await api.put(path, { blocks: FACULTY_MONDAY }, String(created.rowVersion)).expect(409);
    });
  });
});
