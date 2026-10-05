import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { DevicesService } from '../src/modules/devices/devices.module';
import { EmployeesService } from '../src/modules/employees/application/employees.service';
import { loginAs } from './support/auth';

describe('Departments, employees and biometric IDs (e2e)', () => {
  let app: NestExpressApplication;
  let http: App;
  let db: DataSource;
  let auth: string;
  let deviceId: string;
  let departmentId: string;
  let nextNumber = 1;

  const api = {
    get: (path: string) => request(http).get(`/api/v1${path}`).set('Authorization', auth),
    post: (path: string, body?: object) =>
      request(http).post(`/api/v1${path}`).set('Authorization', auth).send(body),
    patch: (path: string, body: object) =>
      request(http).patch(`/api/v1${path}`).set('Authorization', auth).send(body),
  };

  const employeeBody = (overrides: object = {}) => ({
    employeeNumber: `E-${String(nextNumber++).padStart(4, '0')}`,
    firstName: 'Juan',
    middleName: 'Santos',
    lastName: 'Dela Cruz',
    departmentId,
    category: 'NON_TEACHING',
    employmentType: 'PERMANENT',
    ...overrides,
  });
  const createEmployee = async (overrides: object = {}) =>
    (await api.post('/employees', employeeBody(overrides)).expect(201)).body.data as {
      id: string;
      employeeNumber: string;
    };

  const auditActions = async (entityId: string) =>
    (
      await db.query<{ action: string }[]>(
        `SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id`,
        [entityId],
      )
    ).map((r) => r.action);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    db = app.get<DataSource>(getDataSourceToken());
    deviceId = await app.get(DevicesService).ensureDefaultDevice();
    auth = (await loginAs(app, ['HR_ADMIN'])).authorization;
    departmentId = (
      (
        await api
          .post('/departments', { code: 'cas', name: 'College of Arts and Sciences' })
          .expect(201)
      ).body.data as { id: string }
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('access', () => {
    it.each(['/employees', '/departments', '/biometric-devices'])(
      '%s needs a token (401)',
      async (path) => {
        const res = await request(http).get(`/api/v1${path}`).expect(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      },
    );

    it('an EMPLOYEE-only user gets 403', async () => {
      const employee = await loginAs(app, ['EMPLOYEE']);
      await request(http)
        .get('/api/v1/employees')
        .set('Authorization', employee.authorization)
        .expect(403);
    });

    it('lists the seeded MAIN-01 device', async () => {
      const res = await api.get('/biometric-devices').expect(200);
      expect(res.body.data).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: deviceId, code: 'MAIN-01' })]),
      );
    });
  });

  describe('departments', () => {
    it('creates with an uppercased code; a duplicate code is 409', async () => {
      const res = await api
        .post('/departments', { code: ' ceit ', name: 'Engineering' })
        .expect(201);
      expect(res.body.data).toMatchObject({ code: 'CEIT', name: 'Engineering', status: 'ACTIVE' });

      const dup = await api.post('/departments', { code: 'CEIT', name: 'Again' }).expect(409);
      expect(dup.body.error.code).toBe('CONFLICT');
    });

    it('updates, deactivates, filters by status and audits', async () => {
      const { id } = (await api.post('/departments', { code: 'TMP', name: 'Temp' }).expect(201))
        .body.data as { id: string };
      await api.patch(`/departments/${id}`, { name: 'Temporary' }).expect(200);
      const res = await api.post(`/departments/${id}/deactivate`).expect(200);
      expect(res.body.data.status).toBe('INACTIVE');

      const active = (await api.get('/departments?status=ACTIVE').expect(200)).body.data as {
        id: string;
      }[];
      expect(active.map((d) => d.id)).not.toContain(id);
      expect(await auditActions(id)).toEqual([
        'DEPARTMENT_CREATED',
        'DEPARTMENT_UPDATED',
        'DEPARTMENT_DEACTIVATED',
      ]);

      const inDeactivated = await api
        .post('/employees', employeeBody({ departmentId: id }))
        .expect(400);
      expect(inDeactivated.body.error.details).toEqual([
        { field: 'departmentId', message: 'Unknown or inactive department.' },
      ]);
    });

    it('404 for an unknown department, 400 for a malformed id', async () => {
      await api.get('/departments/00000000-0000-4000-8000-000000000000').expect(404);
      await api.get('/departments/not-a-uuid').expect(400);
    });
  });

  describe('employees', () => {
    it('creates, reads and updates an employee, with audit', async () => {
      const created = await api
        .post('/employees', employeeBody({ suffix: 'Jr.', hiredOn: '2019-06-01' }))
        .expect(201);
      const employee = created.body.data;
      expect(employee).toMatchObject({
        fullName: 'Dela Cruz, Juan Santos Jr.',
        status: 'ACTIVE',
        hiredOn: '2019-06-01',
        separatedOn: null,
        email: null,
      });

      await api.get(`/employees/${employee.id}`).expect(200);
      const updated = await api
        .patch(`/employees/${employee.id}`, {
          positionTitle: 'Administrative Officer II',
          middleName: null,
        })
        .expect(200);
      expect(updated.body.data).toMatchObject({
        positionTitle: 'Administrative Officer II',
        middleName: null,
        fullName: 'Dela Cruz, Juan Jr.',
      });
      expect(await auditActions(employee.id)).toEqual(['EMPLOYEE_CREATED', 'EMPLOYEE_UPDATED']);
    });

    it('a duplicate employee number is 409 EMPLOYEE_NUMBER_EXISTS', async () => {
      const { employeeNumber } = await createEmployee();
      const res = await api.post('/employees', employeeBody({ employeeNumber })).expect(409);
      expect(res.body.error.code).toBe('EMPLOYEE_NUMBER_EXISTS');
    });

    it('rejects unknown fields and status changes through PATCH', async () => {
      const { id } = await createEmployee();
      const res = await api.patch(`/employees/${id}`, { status: 'INACTIVE' }).expect(400);
      expect(res.body.error.details).toEqual([
        { field: 'status', message: 'property status should not exist' },
      ]);
      await api.post('/employees', employeeBody({ hiredOn: '2026-02-30' })).expect(400);
    });

    it('is deactivated, never deleted', async () => {
      const { id } = await createEmployee();
      const res = await api
        .post(`/employees/${id}/deactivate`, { separatedOn: '2026-10-31', reason: 'Retired' })
        .expect(200);
      expect(res.body.data).toMatchObject({ status: 'INACTIVE', separatedOn: '2026-10-31' });

      await api.get(`/employees/${id}`).expect(200); // still there
      const del = await request(http)
        .delete(`/api/v1/employees/${id}`)
        .set('Authorization', auth)
        .expect(404);
      expect(del.body.error.code).toBe('NOT_FOUND'); // there is no DELETE route
      const [row] = await db.query<{ status: string }[]>(
        `SELECT status FROM employees WHERE id = $1`,
        [id],
      );
      expect(row?.status).toBe('INACTIVE');

      const [audit] = await db.query<{ reason: string }[]>(
        `SELECT reason FROM audit_logs WHERE entity_id = $1 AND action = 'EMPLOYEE_DEACTIVATED'`,
        [id],
      );
      expect(audit?.reason).toBe('Retired');
      await api.post(`/employees/${id}/deactivate`, { reason: 'twice' }).expect(200); // idempotent
    });

    it('404 EMPLOYEE_NOT_FOUND for an unknown id', async () => {
      const res = await api.get('/employees/00000000-0000-4000-8000-000000000000').expect(404);
      expect(res.body.error.code).toBe('EMPLOYEE_NOT_FOUND');
    });

    describe('list', () => {
      let deptId: string;
      beforeAll(async () => {
        deptId = (
          (await api.post('/departments', { code: 'LIST', name: 'List test' }).expect(201)).body
            .data as {
            id: string;
          }
        ).id;
        for (const [no, first, last] of [
          ['L-003', 'Ana', 'Zamora'],
          ['L-001', 'Ben', 'Abad'],
          ['L-002', 'Carla', 'Mendoza'],
        ] as const) {
          await createEmployee({
            employeeNumber: no,
            firstName: first,
            lastName: last,
            departmentId: deptId,
          });
        }
      });

      it('filters by department, paginates and sorts by last name by default', async () => {
        const res = await api.get(`/employees?departmentId=${deptId}&limit=2`).expect(200);
        expect(res.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
        expect(res.body.data.map((e: { lastName: string }) => e.lastName)).toEqual([
          'Abad',
          'Mendoza',
        ]);

        const page2 = await api.get(`/employees?departmentId=${deptId}&limit=2&page=2`).expect(200);
        expect(page2.body.data.map((e: { lastName: string }) => e.lastName)).toEqual(['Zamora']);
      });

      it('sorts by a whitelisted field', async () => {
        const res = await api
          .get(`/employees?departmentId=${deptId}&sort=employeeNumber&order=desc`)
          .expect(200);
        expect(res.body.data.map((e: { employeeNumber: string }) => e.employeeNumber)).toEqual([
          'L-003',
          'L-002',
          'L-001',
        ]);
      });

      it('searches name and employee number; LIKE wildcards are literal', async () => {
        const byName = await api.get(`/employees?departmentId=${deptId}&q=mend`).expect(200);
        expect(byName.body.data.map((e: { lastName: string }) => e.lastName)).toEqual(['Mendoza']);
        const byNumber = await api.get(`/employees?departmentId=${deptId}&q=L-001`).expect(200);
        expect(byNumber.body.data).toHaveLength(1);
        const fullName = await api
          .get(`/employees?departmentId=${deptId}&q=ana zamora`)
          .expect(200);
        expect(fullName.body.data).toHaveLength(1);
        const wildcard = await api.get(`/employees?departmentId=${deptId}&q=%25`).expect(200);
        expect(wildcard.body.data).toHaveLength(0);
      });

      it('rejects limit > 100 and an unknown sort field', async () => {
        const limit = await api.get('/employees?limit=101').expect(400);
        expect(limit.body.error.details[0].field).toBe('limit');
        const sort = await api.get('/employees?sort=password_hash').expect(400);
        expect(sort.body.error.details[0].field).toBe('sort');
      });
    });
  });

  describe('biometric ID mappings', () => {
    it('maps an ID; an overlapping mapping for another employee is 409 BIOMETRIC_MAPPING_OVERLAP', async () => {
      const a = await createEmployee();
      const b = await createEmployee();
      const mapped = await api
        .post(`/employees/${a.id}/biometric-ids`, {
          deviceId,
          biometricIdentifier: '2001',
          validFrom: '2026-01-01',
        })
        .expect(201);
      expect(mapped.body.data).toMatchObject({ biometricIdentifier: '2001', validTo: null });

      const overlap = await api
        .post(`/employees/${b.id}/biometric-ids`, {
          deviceId,
          biometricIdentifier: '2001',
          validFrom: '2026-09-01',
        })
        .expect(409);
      expect(overlap.body.error.code).toBe('BIOMETRIC_MAPPING_OVERLAP');
    });

    it('closing the old mapping (validTo) and then adding the new one works', async () => {
      const a = await createEmployee();
      const b = await createEmployee();
      const old = (
        await api
          .post(`/employees/${a.id}/biometric-ids`, {
            deviceId,
            biometricIdentifier: '2002',
            validFrom: '2026-01-01',
          })
          .expect(201)
      ).body.data as { id: string };

      const closed = await api
        .patch(`/employees/${a.id}/biometric-ids/${old.id}`, { validTo: '2026-08-31' })
        .expect(200);
      expect(closed.body.data.validTo).toBe('2026-08-31');
      await api
        .post(`/employees/${b.id}/biometric-ids`, {
          deviceId,
          biometricIdentifier: '2002',
          validFrom: '2026-09-01',
        })
        .expect(201);

      const history = await api.get(`/employees/${a.id}/biometric-ids`).expect(200);
      expect(history.body.data).toHaveLength(1);
      expect(await auditActions(a.id)).toEqual(
        expect.arrayContaining(['BIOMETRIC_ID_MAPPED', 'BIOMETRIC_ID_MAPPING_UPDATED']),
      );
    });

    it('validates dates, device and ownership', async () => {
      const a = await createEmployee();
      const b = await createEmployee();
      const backwards = await api
        .post(`/employees/${a.id}/biometric-ids`, {
          deviceId,
          biometricIdentifier: '2003',
          validFrom: '2026-05-01',
          validTo: '2026-04-30',
        })
        .expect(400);
      expect(backwards.body.error.details[0].field).toBe('validTo');

      const unknownDevice = await api
        .post(`/employees/${a.id}/biometric-ids`, {
          deviceId: '00000000-0000-4000-8000-000000000000',
          biometricIdentifier: '2003',
          validFrom: '2026-05-01',
        })
        .expect(400);
      expect(unknownDevice.body.error.details[0].field).toBe('deviceId');

      const mapping = (
        await api
          .post(`/employees/${a.id}/biometric-ids`, {
            deviceId,
            biometricIdentifier: '2003',
            validFrom: '2026-05-01',
          })
          .expect(201)
      ).body.data as { id: string };
      // The mapping belongs to A: addressing it under B is "not found".
      await api
        .patch(`/employees/${b.id}/biometric-ids/${mapping.id}`, { validTo: '2026-06-30' })
        .expect(404);
      await api.patch(`/employees/${a.id}/biometric-ids/${mapping.id}`, {}).expect(400); // validTo required
    });

    it('deactivating with a separation date ends open mappings so the ID can be reused', async () => {
      const leaver = await createEmployee();
      const joiner = await createEmployee();
      await api
        .post(`/employees/${leaver.id}/biometric-ids`, {
          deviceId,
          biometricIdentifier: '2004',
          validFrom: '2026-01-01',
        })
        .expect(201);
      await api
        .post(`/employees/${leaver.id}/deactivate`, {
          separatedOn: '2026-10-15',
          reason: 'Resigned',
        })
        .expect(200);

      const ended = (await api.get(`/employees/${leaver.id}/biometric-ids`).expect(200)).body.data;
      expect(ended[0].validTo).toBe('2026-10-15');
      await api
        .post(`/employees/${joiner.id}/biometric-ids`, {
          deviceId,
          biometricIdentifier: '2004',
          validFrom: '2026-10-16',
        })
        .expect(201);
    });
  });

  describe('EmployeesService (public API, real PostgreSQL)', () => {
    let service: EmployeesService;
    beforeAll(() => {
      service = app.get(EmployeesService);
    });

    it('resolveByBiometric respects valid_from / valid_to (inclusive)', async () => {
      const first = await createEmployee();
      const second = await createEmployee();
      const m = (
        await api
          .post(`/employees/${first.id}/biometric-ids`, {
            deviceId,
            biometricIdentifier: '3001',
            validFrom: '2026-01-01',
            validTo: '2026-06-30',
          })
          .expect(201)
      ).body.data as { id: string };
      expect(m.id).toBeDefined();
      await api
        .post(`/employees/${second.id}/biometric-ids`, {
          deviceId,
          biometricIdentifier: '3001',
          validFrom: '2026-07-01',
        })
        .expect(201);

      expect(await service.resolveByBiometric(deviceId, '3001', '2025-12-31')).toBeNull();
      expect(await service.resolveByBiometric(deviceId, '3001', '2026-01-01')).toBe(first.id);
      expect(await service.resolveByBiometric(deviceId, '3001', '2026-06-30')).toBe(first.id);
      expect(await service.resolveByBiometric(deviceId, '3001', '2026-07-01')).toBe(second.id);
      expect(await service.resolveByBiometric(deviceId, '3001', '2030-01-01')).toBe(second.id);
      expect(await service.resolveByBiometric(deviceId, '9999', '2026-07-01')).toBeNull();
    });

    it('listActive includes employees separated inside the range, not before it', async () => {
      const { id: deptId } = (
        await api.post('/departments', { code: 'ACT', name: 'Active test' }).expect(201)
      ).body.data as { id: string };
      const stays = await createEmployee({ departmentId: deptId, lastName: 'Stays' });
      const leavesMid = await createEmployee({ departmentId: deptId, lastName: 'LeavesMid' });
      const leftBefore = await createEmployee({ departmentId: deptId, lastName: 'LeftBefore' });
      const hiredAfter = await createEmployee({
        departmentId: deptId,
        lastName: 'HiredAfter',
        hiredOn: '2026-11-01',
      });
      await api
        .post(`/employees/${leavesMid.id}/deactivate`, { separatedOn: '2026-10-10', reason: 'x' })
        .expect(200);
      await api
        .post(`/employees/${leftBefore.id}/deactivate`, { separatedOn: '2026-09-30', reason: 'x' })
        .expect(200);

      const active = await service.listActive({ from: '2026-10-01', to: '2026-10-15' }, deptId);
      expect(active.map((e) => e.id).sort()).toEqual([stays.id, leavesMid.id].sort());
      expect(active.map((e) => e.id)).not.toContain(leftBefore.id);
      expect(active.map((e) => e.id)).not.toContain(hiredAfter.id);
      expect(await service.departmentOf(stays.id)).toBe(deptId);
    });
  });
});
