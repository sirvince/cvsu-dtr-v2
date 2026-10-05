import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DATABASE-MAPPING §5: schedule templates, employee schedules (full v3 status set incl. ENDORSED,
 * ADR-28; row_version, ADR-38) and their blocks. Runs as `migrator`.
 */
export class Schedules1791100000004 implements MigrationInterface {
  name = 'Schedules1791100000004';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE schedule_templates (
        id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name   text NOT NULL UNIQUE,
        blocks jsonb NOT NULL,
        status text NOT NULL DEFAULT 'ACTIVE'
      )`);

    await q.query(`
      CREATE TABLE employee_schedules (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id       uuid NOT NULL REFERENCES employees(id),
        semester_id       uuid NOT NULL REFERENCES semesters(id),
        effective_from    date NOT NULL,
        effective_to      date NOT NULL,
        status            text NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT','SUBMITTED','ENDORSED','APPROVED','REJECTED','SUPERSEDED')),
        version           int NOT NULL DEFAULT 1,
        row_version       int NOT NULL DEFAULT 1,
        approved_directly boolean NOT NULL DEFAULT false,
        submitted_at      timestamptz,
        endorsed_by       uuid REFERENCES users(id),
        endorsed_at       timestamptz,
        reviewed_by       uuid REFERENCES users(id),
        reviewed_at       timestamptz,
        review_remarks    text,
        created_by        uuid REFERENCES users(id),
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now(),
        CHECK (effective_from <= effective_to),
        CHECK ((endorsed_by IS NULL) = (endorsed_at IS NULL)),
        CHECK (status <> 'ENDORSED' OR endorsed_by IS NOT NULL),
        CHECK (NOT approved_directly OR (status IN ('APPROVED','SUPERSEDED')
                                         AND submitted_at IS NULL AND endorsed_by IS NULL)),
        CHECK (status = 'DRAFT' OR approved_directly OR submitted_at IS NOT NULL),
        -- 🔒 maker-checker at every level of the workflow (ADR-28)
        CHECK (endorsed_by IS NULL OR endorsed_by <> created_by),
        CHECK (approved_directly OR reviewed_by IS NULL OR reviewed_by <> created_by),
        CHECK (endorsed_by IS NULL OR reviewed_by IS NULL OR endorsed_by <> reviewed_by),
        -- 🔒 at most one APPROVED schedule per employee per date
        CONSTRAINT ex_employee_schedules_one_approved EXCLUDE USING gist (
          employee_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&)
          WHERE (status = 'APPROVED')
      )`);
    await q.query(
      `CREATE INDEX idx_employee_schedules_employee ON employee_schedules(employee_id, effective_from)`,
    );

    // Non-overlap of blocks within a day is validated in the domain (ScheduleValidator).
    await q.query(`
      CREATE TABLE schedule_blocks (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_schedule_id uuid NOT NULL REFERENCES employee_schedules(id) ON DELETE CASCADE,
        day_of_week          smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
        block_no             smallint NOT NULL CHECK (block_no >= 1),
        start_time           time NOT NULL,
        end_time             time NOT NULL,
        CHECK (start_time < end_time),
        UNIQUE (employee_schedule_id, day_of_week, block_no)
      )`);

    await q.query(`GRANT SELECT, INSERT, UPDATE ON schedule_templates TO app_user`);
    // Schedules are superseded, never deleted: history is kept (BUSINESS-RULES §6).
    await q.query(`GRANT SELECT, INSERT, UPDATE ON employee_schedules TO app_user`);
    // Blocks of a not-yet-used schedule may be replaced (PUT).
    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON schedule_blocks TO app_user`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE schedule_blocks`);
    await q.query(`DROP TABLE employee_schedules`);
    await q.query(`DROP TABLE schedule_templates`);
  }
}
