import type { DataSource } from 'typeorm';
import { translateDbError } from '../src/database/db-errors';
import { AuditLog } from '../src/modules/audit/audit-log.entity';
import { AuditService } from '../src/modules/audit/audit.service';
import { connect, startTestDatabase, type TestDatabase } from './support/postgres';

const TABLES_0001 = [
  'audit_logs',
  'password_reset_tokens',
  'refresh_tokens',
  'user_roles',
  'users',
];
const TABLES_0002 = [
  'biometric_devices',
  'departments',
  'employee_biometric_ids',
  'employees',
  'user_department_scopes',
];
const TABLES_0003 = [
  'academic_years',
  'calendar_event_departments',
  'calendar_events',
  'dtr_periods',
  'semesters',
];
const TABLES_0004 = ['employee_schedules', 'schedule_blocks', 'schedule_templates'];

/** Postgres error as pg reports it inside TypeORM's QueryFailedError. */
async function pgError(promise: Promise<unknown>): Promise<{ code: string; constraint?: string }> {
  try {
    await promise;
  } catch (error) {
    return (error as { driverError: { code: string; constraint?: string } }).driverError;
  }
  throw new Error('expected the query to fail');
}

describe('database foundation (Testcontainers, PostgreSQL 17)', () => {
  let db: TestDatabase;
  let migrator: DataSource;
  let app: DataSource;

  const publicTables = async () =>
    (
      await migrator.query<{ tablename: string }[]>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'typeorm_migrations' ORDER BY 1`,
      )
    ).map((r) => r.tablename);

  beforeAll(async () => {
    db = await startTestDatabase();
    migrator = await connect(db.migratorUrl);
  });

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (migrator?.isInitialized) await migrator.destroy();
    await db?.container.stop();
  });

  it('migration:run on an empty database creates every table, owned by migrator', async () => {
    expect(await publicTables()).toEqual([]);
    const ran = await migrator.runMigrations({ transaction: 'each' });
    expect(ran.map((m) => m.name)).toEqual([
      'InitUsersAuth1791100000001',
      'OrgAndDevices1791100000002',
      'AcademicCalendar1791100000003',
      'Schedules1791100000004',
    ]);
    expect(await publicTables()).toEqual(
      [...TABLES_0001, ...TABLES_0002, ...TABLES_0003, ...TABLES_0004].sort(),
    );

    const owners = await migrator.query<{ tableowner: string }[]>(
      `SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public'`,
    );
    expect(owners).toEqual([{ tableowner: 'migrator' }]);

    app = await connect(db.appUrl, { entities: [AuditLog] });
  });

  describe('as app_user', () => {
    it('connects as app_user with a UTC session and dates as strings', async () => {
      const [row] = await app.query<{ user: string; tz: string; d: unknown }[]>(
        `SELECT current_user AS "user", current_setting('TimeZone') AS tz, '2026-10-05'::date AS d`,
      );
      expect(row).toEqual({ user: 'app_user', tz: 'UTC', d: '2026-10-05' });
    });

    it('cannot change the schema', async () => {
      expect((await pgError(app.query(`CREATE TABLE hack (id int)`))).code).toBe('42501');
      expect((await pgError(app.query(`DROP TABLE users`))).code).toBe('42501');
    });

    it('audit_logs is append-only: INSERT and SELECT yes, UPDATE / DELETE / TRUNCATE denied', async () => {
      await new AuditService().record(app.manager, {
        actor: { userId: '00000000-0000-4000-8000-000000000001', roles: ['HR_ADMIN'] },
        action: 'TEST_RECORDED',
        entityType: 'probe',
        entityId: '00000000-0000-4000-8000-000000000002',
        before: { status: 'DRAFT' },
        after: { status: 'FINALIZED' },
        reason: 'int test',
        requestId: 'req_int',
        ip: '10.1.2.3',
        userAgent: 'jest',
      });

      const [row] = await app.query<Record<string, unknown>[]>(
        `SELECT * FROM audit_logs WHERE action = 'TEST_RECORDED'`,
      );
      expect(row).toMatchObject({
        actor_roles: ['HR_ADMIN'],
        entity_type: 'probe',
        before: { status: 'DRAFT' },
        after: { status: 'FINALIZED' },
        request_id: 'req_int',
        ip: '10.1.2.3',
      });
      expect(row?.occurred_at).toBeInstanceOf(Date);

      for (const sql of [
        `UPDATE audit_logs SET action = 'TAMPERED'`,
        `DELETE FROM audit_logs`,
        `TRUNCATE audit_logs`,
      ]) {
        expect((await pgError(app.query(sql))).code).toBe('42501'); // insufficient_privilege
      }
    });

    it('records a system action with no actor', async () => {
      await new AuditService().record(app.manager, {
        actor: null,
        action: 'SYSTEM_TICK',
        entityType: 'probe',
      });
      const [row] = await app.query<Record<string, unknown>[]>(
        `SELECT actor_user_id, actor_roles FROM audit_logs WHERE action = 'SYSTEM_TICK'`,
      );
      expect(row).toEqual({ actor_user_id: null, actor_roles: null });
    });

    it('cannot delete master data (deactivate instead)', async () => {
      expect((await pgError(app.query(`DELETE FROM departments`))).code).toBe('42501');
      expect((await pgError(app.query(`DELETE FROM employees`))).code).toBe('42501');
    });

    describe('employee_biometric_ids 🔒 no overlapping mapping', () => {
      let deviceId: string;
      let employeeA: string;
      let employeeB: string;

      beforeAll(async () => {
        const [dept] = await app.query<{ id: string }[]>(
          `INSERT INTO departments (code, name) VALUES ('CAS', 'College of Arts and Sciences') RETURNING id`,
        );
        const insertEmployee = async (no: string) =>
          (
            await app.query<{ id: string }[]>(
              `INSERT INTO employees (employee_number, first_name, last_name, department_id, category, employment_type)
               VALUES ($1, 'Test', 'Employee', $2, 'NON_TEACHING', 'PERMANENT') RETURNING id`,
              [no, dept?.id],
            )
          )[0]!.id;
        employeeA = await insertEmployee('E-0001');
        employeeB = await insertEmployee('E-0002');
        deviceId = (
          await app.query<{ id: string }[]>(
            `INSERT INTO biometric_devices (code, name) VALUES ('MAIN-01', 'Main gate') RETURNING id`,
          )
        )[0]!.id;
      });

      const map = (employeeId: string, id: string, from: string, to: string | null) =>
        app.query(
          `INSERT INTO employee_biometric_ids (employee_id, device_id, biometric_identifier, valid_from, valid_to)
           VALUES ($1, $2, $3, $4, $5)`,
          [employeeId, deviceId, id, from, to],
        );

      it('rejects a second employee on the same device + ID for an overlapping range (23P01)', async () => {
        await map(employeeA, '1001', '2026-01-01', '2026-06-30');
        const error = await pgError(map(employeeB, '1001', '2026-06-30', null));
        expect(error).toMatchObject({ code: '23P01', constraint: 'ex_biometric_ids_no_overlap' });
      });

      it('maps the violation to 409 BIOMETRIC_MAPPING_OVERLAP', async () => {
        let thrown: unknown;
        try {
          await map(employeeB, '1001', '2026-03-01', '2026-03-31');
        } catch (error) {
          thrown = error;
        }
        expect(translateDbError(thrown)).toMatchObject({
          code: 'BIOMETRIC_MAPPING_OVERLAP',
          kind: 'CONFLICT',
        });
      });

      it('allows the same ID after the previous mapping ends, or on another device or ID', async () => {
        await expect(map(employeeB, '1001', '2026-07-01', null)).resolves.toBeDefined();
        await expect(map(employeeB, '1002', '2026-01-01', null)).resolves.toBeDefined();
      });

      it('maps a duplicate employee number to 409 EMPLOYEE_NUMBER_EXISTS', async () => {
        let thrown: unknown;
        try {
          await app.query(
            `INSERT INTO employees (employee_number, first_name, last_name, department_id, category, employment_type)
             SELECT 'E-0001', 'Dup', 'Licate', department_id, 'FACULTY', 'COS' FROM employees LIMIT 1`,
          );
        } catch (error) {
          thrown = error;
        }
        expect(translateDbError(thrown)).toMatchObject({
          code: 'EMPLOYEE_NUMBER_EXISTS',
          kind: 'CONFLICT',
        });
      });
    });

    describe('employee_schedules 🔒 at most one APPROVED schedule per date', () => {
      let employeeId: string;
      let semesterId: string;
      const insert = (status: string, from: string, to: string) =>
        app.query(
          `INSERT INTO employee_schedules (employee_id, semester_id, effective_from, effective_to, status, approved_directly)
           VALUES ($1, $2, $3, $4, $5, true)`,
          [employeeId, semesterId, from, to, status],
        );

      beforeAll(async () => {
        const [year] = await app.query<{ id: string }[]>(
          `INSERT INTO academic_years (code, start_date, end_date) VALUES ('2026-2027', '2026-08-01', '2027-07-31') RETURNING id`,
        );
        const [semester] = await app.query<{ id: string }[]>(
          `INSERT INTO semesters (academic_year_id, code, start_date, end_date) VALUES ($1, 'FIRST', '2026-08-11', '2026-12-19') RETURNING id`,
          [year!.id],
        );
        const [employee] = await app.query<{ id: string }[]>(
          `SELECT id FROM employees WHERE employee_number = 'E-0001'`,
        );
        semesterId = semester!.id;
        employeeId = employee!.id;
      });

      it('a second overlapping APPROVED schedule is refused (23P01 → 409 SCHEDULE_OVERLAP)', async () => {
        await insert('APPROVED', '2026-08-11', '2026-10-15');
        let thrown: unknown;
        try {
          await insert('APPROVED', '2026-10-15', '2026-12-19');
        } catch (error) {
          thrown = error;
        }
        expect(translateDbError(thrown)).toMatchObject({ code: 'SCHEDULE_OVERLAP' });
      });

      it('a SUPERSEDED schedule may overlap; the next day may start a new APPROVED one', async () => {
        await expect(insert('SUPERSEDED', '2026-08-11', '2026-12-19')).resolves.toBeDefined();
        await expect(insert('APPROVED', '2026-10-16', '2026-12-19')).resolves.toBeDefined();
      });

      it('app_user cannot delete a schedule', async () => {
        expect((await pgError(app.query(`DELETE FROM employee_schedules`))).code).toBe('42501');
      });
    });

    describe('dtr_periods 🔒 semi-monthly, no overlap', () => {
      const insert = (start: string, end: string, half: number) =>
        app.query(
          `INSERT INTO dtr_periods (name, start_date, end_date, period_half) VALUES ('p', $1, $2, $3)`,
          [start, end, half],
        );

      it('accepts real halves, including February 16–28', async () => {
        await expect(insert('2027-02-01', '2027-02-15', 1)).resolves.toBeDefined();
        await expect(insert('2027-02-16', '2027-02-28', 2)).resolves.toBeDefined();
      });

      it('rejects anything that is not exactly one half of a month (23514)', async () => {
        for (const [start, end, half] of [
          ['2027-03-01', '2027-03-14', 1], // too short
          ['2027-03-16', '2027-03-30', 2], // March has 31 days
          ['2027-03-02', '2027-03-16', 1], // wrong start day
          ['2027-03-01', '2027-03-31', 1], // a whole month (v2 shape)
        ] as const) {
          const error = await pgError(insert(start, end, half));
          expect(error).toMatchObject({ code: '23514', constraint: 'ck_dtr_periods_semi_monthly' });
        }
      });

      it('rejects an overlapping period and maps it to 409 PERIOD_OVERLAP', async () => {
        let thrown: unknown;
        try {
          await insert('2027-02-01', '2027-02-15', 1);
        } catch (error) {
          thrown = error;
        }
        expect((thrown as { driverError: { code: string } }).driverError.code).toBe('23P01');
        expect(translateDbError(thrown)).toMatchObject({
          code: 'PERIOD_OVERLAP',
          kind: 'CONFLICT',
        });
      });

      it('a GOVERNMENT_ANNOUNCEMENT can never be department-scoped (23514)', async () => {
        const error = await pgError(
          app.query(
            `INSERT INTO calendar_events (event_date, type, name, scope) VALUES ('2026-10-27', 'GOVERNMENT_ANNOUNCEMENT', 'x', 'DEPARTMENTS')`,
          ),
        );
        expect(error.code).toBe('23514');
      });

      it('app_user cannot delete a period', async () => {
        expect((await pgError(app.query(`DELETE FROM dtr_periods`))).code).toBe('42501');
      });
    });
  });

  it('migration:revert removes every table again', async () => {
    await app.destroy();
    await migrator.undoLastMigration({ transaction: 'each' });
    expect(await publicTables()).toEqual([...TABLES_0001, ...TABLES_0002, ...TABLES_0003].sort());
    await migrator.undoLastMigration({ transaction: 'each' });
    expect(await publicTables()).toEqual([...TABLES_0001, ...TABLES_0002].sort());
    await migrator.undoLastMigration({ transaction: 'each' });
    expect(await publicTables()).toEqual(TABLES_0001);
    await migrator.undoLastMigration({ transaction: 'each' });
    expect(await publicTables()).toEqual([]);

    const extensions = await migrator.query<unknown[]>(
      `SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto', 'citext', 'btree_gist')`,
    );
    expect(extensions).toEqual([]);
  });
});
