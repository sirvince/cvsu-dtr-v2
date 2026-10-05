import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DATABASE-MAPPING §5 (departments, employees, devices, biometric IDs) and §4
 * (user_department_scopes, which references departments). Runs as `migrator`.
 */
export class OrgAndDevices1791100000002 implements MigrationInterface {
  name = 'OrgAndDevices1791100000002';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE departments (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code       text NOT NULL UNIQUE,
        name       text NOT NULL,
        campus     text,
        status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE employees (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_number text NOT NULL UNIQUE,
        first_name      text NOT NULL,
        middle_name     text,
        last_name       text NOT NULL,
        suffix          text,
        email           citext,
        department_id   uuid NOT NULL REFERENCES departments(id),
        user_id         uuid UNIQUE REFERENCES users(id),
        position_title  text,
        category        text NOT NULL CHECK (category IN ('FACULTY','NON_TEACHING')),
        employment_type text NOT NULL CHECK (employment_type IN
                        ('PERMANENT','TEMPORARY','CONTRACTUAL','CASUAL','PART_TIME','COS','JO')),
        status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
        hired_on        date,
        separated_on    date,
        created_by      uuid REFERENCES users(id),
        updated_by      uuid REFERENCES users(id),
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_employees_department ON employees(department_id)`);

    await q.query(`
      CREATE TABLE biometric_devices (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code          text NOT NULL UNIQUE,
        name          text NOT NULL,
        location      text,
        model         text DEFAULT 'ZKTeco MB20',
        serial_number text UNIQUE,
        status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
      )`);

    // 🔒 One biometric ID on one device maps to at most one employee at any date.
    // The constraint name is mapped to 409 BIOMETRIC_MAPPING_OVERLAP (common/database/db-errors.ts).
    await q.query(`
      CREATE TABLE employee_biometric_ids (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id          uuid NOT NULL REFERENCES employees(id),
        device_id            uuid NOT NULL REFERENCES biometric_devices(id),
        biometric_identifier text NOT NULL,
        valid_from           date NOT NULL,
        valid_to             date,
        created_by           uuid REFERENCES users(id),
        created_at           timestamptz NOT NULL DEFAULT now(),
        CHECK (valid_to IS NULL OR valid_from <= valid_to),
        CONSTRAINT ex_biometric_ids_no_overlap EXCLUDE USING gist (
          device_id WITH =, biometric_identifier WITH =,
          daterange(valid_from, valid_to, '[]') WITH &&)
      )`);
    // ADR-24: reconciliation scope = employees mapped to the import batch's device
    await q.query(
      `CREATE INDEX idx_biometric_ids_employee ON employee_biometric_ids(employee_id, device_id)`,
    );

    await q.query(`
      CREATE TABLE user_department_scopes (
        user_id       uuid NOT NULL REFERENCES users(id),
        department_id uuid NOT NULL REFERENCES departments(id),
        PRIMARY KEY (user_id, department_id)
      )`);

    // Master data is deactivated, never deleted. A mapping ends by setting valid_to.
    await q.query(`GRANT SELECT, INSERT, UPDATE ON departments TO app_user`);
    await q.query(`GRANT SELECT, INSERT, UPDATE ON employees TO app_user`);
    await q.query(`GRANT SELECT, INSERT, UPDATE ON biometric_devices TO app_user`);
    await q.query(`GRANT SELECT, INSERT, UPDATE ON employee_biometric_ids TO app_user`);
    // PUT /users/:id/department-scopes replaces the set.
    await q.query(`GRANT SELECT, INSERT, DELETE ON user_department_scopes TO app_user`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE user_department_scopes`);
    await q.query(`DROP TABLE employee_biometric_ids`);
    await q.query(`DROP TABLE biometric_devices`);
    await q.query(`DROP TABLE employees`);
    await q.query(`DROP TABLE departments`);
  }
}
