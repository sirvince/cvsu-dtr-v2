import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PeriodsService } from '../src/modules/academic-periods/application/periods.service';
import { CalendarService } from '../src/modules/calendar/calendar.service';
import { loginAs } from './support/auth';

interface Period {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  periodHalf: 1 | 2;
  status: string;
  semesterId: string | null;
  plannedAdvanceDate: string | null;
}

describe('Academic calendar, DTR periods and calendar events (e2e)', () => {
  let app: NestExpressApplication;
  let http: App;
  let auth: string;
  let semesterId: string;

  const api = {
    get: (path: string) => request(http).get(`/api/v1${path}`).set('Authorization', auth),
    post: (path: string, body?: object) =>
      request(http).post(`/api/v1${path}`).set('Authorization', auth).send(body),
    patch: (path: string, body: object) =>
      request(http).patch(`/api/v1${path}`).set('Authorization', auth).send(body),
    delete: (path: string) => request(http).delete(`/api/v1${path}`).set('Authorization', auth),
  };
  const createMonth = async (year: number, month: number, extra: object = {}) =>
    (await api.post('/dtr-periods/month', { year, month, ...extra }).expect(201)).body
      .data as Period[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    auth = (await loginAs(app, ['HR_ADMIN'])).authorization;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('academic years and semesters', () => {
    it('creates a year and a semester inside it', async () => {
      const year = (
        await api
          .post('/academic-years', {
            code: '2026-2027',
            startDate: '2026-08-01',
            endDate: '2027-07-31',
          })
          .expect(201)
      ).body.data as { id: string };

      const semester = await api
        .post(`/academic-years/${year.id}/semesters`, {
          code: 'FIRST',
          startDate: '2026-08-11',
          endDate: '2026-12-19',
        })
        .expect(201);
      semesterId = semester.body.data.id as string;

      const list = await api.get('/academic-years').expect(200);
      expect(list.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: '2026-2027',
            semesters: [expect.objectContaining({ code: 'FIRST', startDate: '2026-08-11' })],
          }),
        ]),
      );
    });

    it('rejects a semester outside its year or overlapping a sibling; duplicate codes are 409', async () => {
      const year = (
        await api
          .post('/academic-years', {
            code: '2027-2028',
            startDate: '2027-08-01',
            endDate: '2028-07-31',
          })
          .expect(201)
      ).body.data as { id: string };
      const add = (body: object) => api.post(`/academic-years/${year.id}/semesters`, body);

      await add({ code: 'FIRST', startDate: '2027-07-01', endDate: '2027-12-19' }).expect(400);
      await add({ code: 'FIRST', startDate: '2027-08-11', endDate: '2027-12-19' }).expect(201);
      const overlap = await add({
        code: 'SECOND',
        startDate: '2027-12-01',
        endDate: '2028-05-20',
      }).expect(409);
      expect(overlap.body.error.message).toMatch(/FIRST/);
      await add({ code: 'FIRST', startDate: '2028-06-01', endDate: '2028-07-15' }).expect(409);
      await api
        .post('/academic-years', {
          code: '2027-2028',
          startDate: '2027-08-01',
          endDate: '2028-07-31',
        })
        .expect(409);
    });
  });

  describe('DTR periods (ADR-21)', () => {
    it('POST /dtr-periods/month {2026, 10} creates Oct 1–15 and 16–31, OPEN, in the covering semester', async () => {
      const [first, second] = await createMonth(2026, 10);
      expect(first).toMatchObject({
        name: 'Oct 2026 (1–15)',
        startDate: '2026-10-01',
        endDate: '2026-10-15',
        periodHalf: 1,
        status: 'OPEN',
        semesterId,
        plannedAdvanceDate: null,
        advance: null,
      });
      expect(second).toMatchObject({
        name: 'Oct 2026 (16–31)',
        startDate: '2026-10-16',
        endDate: '2026-10-31',
        periodHalf: 2,
      });
    });

    it('{2027, 2} → Feb 1–15 and Feb 16–28', async () => {
      const [, second] = await createMonth(2027, 2);
      expect(second).toMatchObject({
        startDate: '2027-02-16',
        endDate: '2027-02-28',
        name: 'Feb 2027 (16–28)',
      });
    });

    it('creating the same month again → 409 PERIOD_OVERLAP and nothing is created', async () => {
      const before = (await api.get('/dtr-periods?year=2026').expect(200)).body.data
        .length as number;
      const res = await api.post('/dtr-periods/month', { year: 2026, month: 10 }).expect(409);
      expect(res.body.error.code).toBe('PERIOD_OVERLAP');
      expect((await api.get('/dtr-periods?year=2026').expect(200)).body.data).toHaveLength(before);
    });

    it('accepts planned advance dates and rejects one outside [start, end) with 422', async () => {
      const [first, second] = await createMonth(2026, 11, {
        plannedAdvanceDates: { first: '2026-11-13', second: '2026-11-27' },
      });
      expect(first?.plannedAdvanceDate).toBe('2026-11-13');
      expect(second?.plannedAdvanceDate).toBe('2026-11-27');

      const onEnd = await api
        .post('/dtr-periods/month', {
          year: 2026,
          month: 12,
          plannedAdvanceDates: { first: '2026-12-15' },
        })
        .expect(422);
      expect(onEnd.body.error.code).toBe('ADVANCE_DATE_OUT_OF_PERIOD');

      const patched = await api
        .patch(`/dtr-periods/${first!.id}`, { plannedAdvanceDate: '2026-11-12' })
        .expect(200);
      expect(patched.body.data.plannedAdvanceDate).toBe('2026-11-12');
      const outside = await api
        .patch(`/dtr-periods/${first!.id}`, { plannedAdvanceDate: '2026-11-16' })
        .expect(422);
      expect(outside.body.error.code).toBe('ADVANCE_DATE_OUT_OF_PERIOD');
      await api.patch(`/dtr-periods/${first!.id}`, { plannedAdvanceDate: null }).expect(200);
    });

    it('validates the month request', async () => {
      await api.post('/dtr-periods/month', { year: 2026, month: 13 }).expect(400);
      await api.post('/dtr-periods/month', { year: 2026 }).expect(400);
      const semester = await api
        .post('/dtr-periods/month', {
          year: 2029,
          month: 1,
          semesterId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(400);
      expect(semester.body.error.details[0].field).toBe('semesterId');
    });

    it('closes a period; a closed period is no longer OPEN for processing or edits', async () => {
      const [first] = await createMonth(2027, 1);
      const service = app.get(PeriodsService);
      await expect(service.assertOpen(first!.id)).resolves.toMatchObject({ status: 'OPEN' });

      const closed = await api.post(`/dtr-periods/${first!.id}/close`).expect(200);
      expect(closed.body.data.status).toBe('CLOSED');
      await api.post(`/dtr-periods/${first!.id}/close`).expect(200); // idempotent

      await expect(service.assertOpen(first!.id)).rejects.toMatchObject({
        code: 'PERIOD_NOT_OPEN',
      });
      const edit = await api
        .patch(`/dtr-periods/${first!.id}`, { submissionDeadline: '2027-01-20' })
        .expect(422);
      expect(edit.body.error.code).toBe('PERIOD_NOT_OPEN');
    });

    it('PeriodsService: periodContaining and nextOpenPeriodAfter', async () => {
      const service = app.get(PeriodsService);
      const oct = await service.periodContaining('2026-10-20');
      expect(oct?.name).toBe('Oct 2026 (16–31)');
      expect(await service.periodContaining('2031-01-01')).toBeNull();

      const next = await service.nextOpenPeriodAfter(oct!.id);
      expect(next?.name).toBe('Nov 2026 (1–15)');
      expect((await service.semesterOf('2026-10-20'))?.id).toBe(semesterId);
      expect((await service.academicYearOf('2027-03-01'))?.code).toBe('2026-2027');
    });

    it('HR_STAFF can read periods but not create them', async () => {
      const staff = await loginAs(app, ['HR_STAFF']);
      await request(http)
        .get('/api/v1/dtr-periods')
        .set('Authorization', staff.authorization)
        .expect(200);
      await request(http)
        .post('/api/v1/dtr-periods/month')
        .set('Authorization', staff.authorization)
        .send({ year: 2030, month: 1 })
        .expect(403);
    });
  });

  describe('calendar events', () => {
    it('enters Oct–Dec 2026 holidays with proclamation references (A9 prerequisite)', async () => {
      for (const [eventDate, name] of [
        ['2026-11-01', "All Saints' Day"],
        ['2026-11-30', 'Bonifacio Day'],
        ['2026-12-25', 'Christmas Day'],
        ['2026-12-30', 'Rizal Day'],
      ] as const) {
        await api
          .post('/calendar-events', {
            eventDate,
            type: eventDate === '2026-11-01' ? 'SPECIAL_NON_WORKING' : 'REGULAR_HOLIDAY',
            name,
            reference: 'Proclamation No. 1006, s. 2025',
          })
          .expect(201);
      }
      const res = await api.get('/calendar-events?from=2026-10-01&to=2026-12-31').expect(200);
      expect(res.body.data.map((e: { eventDate: string }) => e.eventDate)).toEqual([
        '2026-11-01',
        '2026-11-30',
        '2026-12-25',
        '2026-12-30',
      ]);
      expect(res.body.data[1]).toMatchObject({
        type: 'REGULAR_HOLIDAY',
        startTime: null,
        scope: 'ALL',
        excusesAttendance: true,
        reference: 'Proclamation No. 1006, s. 2025',
      });
    });

    it('a partial-day suspension and government announcement keep HH:mm times', async () => {
      const suspension = await api
        .post('/calendar-events', {
          eventDate: '2026-10-21',
          type: 'WORK_SUSPENSION',
          name: 'Typhoon suspension',
          startTime: '15:00',
        })
        .expect(201);
      expect(suspension.body.data).toMatchObject({ startTime: '15:00', endTime: null });

      const announcement = await api
        .post('/calendar-events', {
          eventDate: '2026-10-22',
          type: 'GOVERNMENT_ANNOUNCEMENT',
          name: 'Early dismissal',
          startTime: '13:00',
          endTime: '17:00',
          reference: 'MC No. 12, s. 2026',
        })
        .expect(201);
      expect(announcement.body.data).toMatchObject({
        scope: 'ALL',
        startTime: '13:00',
        endTime: '17:00',
      });
    });

    it('validates types and times', async () => {
      const post = (body: object) =>
        api.post('/calendar-events', { eventDate: '2026-10-23', name: 'x', ...body });
      expect(
        (await post({ type: 'REGULAR_HOLIDAY', startTime: '08:00' }).expect(400)).body.error
          .details[0].field,
      ).toBe('startTime');
      expect(
        (await post({ type: 'WORK_SUSPENSION', endTime: '17:00' }).expect(400)).body.error
          .details[0].field,
      ).toBe('startTime');
      expect(
        (await post({ type: 'WORK_SUSPENSION', startTime: '17:00', endTime: '13:00' }).expect(400))
          .body.error.details[0].field,
      ).toBe('endTime');
      await post({ type: 'WORK_SUSPENSION', startTime: '3pm' }).expect(400);
      await post({ type: 'CAMPUS_EVENT' }).expect(400); // not a Phase 1 type
    });

    it('a government announcement is government-wide: a department scope is rejected; 15:00 partial day is fine (R02)', async () => {
      const scoped = await api
        .post('/calendar-events', {
          eventDate: '2026-10-27',
          type: 'GOVERNMENT_ANNOUNCEMENT',
          name: 'Scoped',
          scope: 'DEPARTMENTS',
        })
        .expect(400);
      expect(scoped.body.error.details).toEqual([
        { field: 'scope', message: 'property scope should not exist' },
      ]);
      await api
        .post('/calendar-events', {
          eventDate: '2026-10-27',
          type: 'GOVERNMENT_ANNOUNCEMENT',
          name: 'Afternoon off',
          startTime: '15:00',
        })
        .expect(201);
    });

    it('a special working day does not excuse attendance', async () => {
      const res = await api
        .post('/calendar-events', {
          eventDate: '2026-12-26',
          type: 'SPECIAL_WORKING',
          name: 'Make-up working day',
        })
        .expect(201);
      expect(res.body.data.excusesAttendance).toBe(false);
    });

    it('CalendarService.eventsFor returns events for the date; delete removes it (audited)', async () => {
      const service = app.get(CalendarService);
      const events = await service.eventsFor('2026-11-30', '00000000-0000-4000-8000-000000000000');
      expect(events.map((e) => e.name)).toEqual(['Bonifacio Day']);
      expect(await service.eventsFor('2026-11-29', '00000000-0000-4000-8000-000000000000')).toEqual(
        [],
      );

      await api.delete(`/calendar-events/${events[0]!.id}`).expect(204);
      const db = app.get<DataSource>(getDataSourceToken());
      const [audit] = await db.query<{ action: string; before: { name: string } }[]>(
        `SELECT action, before FROM audit_logs WHERE entity_id = $1 AND action = 'CALENDAR_EVENT_DELETED'`,
        [events[0]!.id],
      );
      expect(audit?.before.name).toBe('Bonifacio Day');
      await api.get(`/calendar-events/${events[0]!.id}`).expect(404);
      await api.delete(`/calendar-events/${events[0]!.id}`).expect(404);
    });
  });
});
