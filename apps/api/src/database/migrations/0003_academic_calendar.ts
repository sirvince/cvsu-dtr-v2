import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DATABASE-MAPPING §5: academic years, semesters, semi-monthly DTR periods (ADR-21) and the
 * calendar (holidays, suspensions, government announcements, ADR-27). Runs as `migrator`.
 */
export class AcademicCalendar1791100000003 implements MigrationInterface {
  name = 'AcademicCalendar1791100000003';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE academic_years (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code       text NOT NULL UNIQUE,
        start_date date NOT NULL,
        end_date   date NOT NULL,
        status     text NOT NULL DEFAULT 'ACTIVE',
        CHECK (start_date < end_date)
      )`);

    await q.query(`
      CREATE TABLE semesters (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        academic_year_id uuid NOT NULL REFERENCES academic_years(id),
        code             text NOT NULL CHECK (code IN ('FIRST','SECOND','MIDYEAR')),
        start_date       date NOT NULL,
        end_date         date NOT NULL,
        status           text NOT NULL DEFAULT 'ACTIVE',
        UNIQUE (academic_year_id, code),
        CHECK (start_date < end_date)
      )`);

    // 🔒 Periods never overlap, and each is exactly one half of a month (ADR-21).
    // semester_id is informational: a period may straddle two semesters.
    await q.query(`
      CREATE TABLE dtr_periods (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name                 text NOT NULL,
        start_date           date NOT NULL,
        end_date             date NOT NULL,
        period_half          smallint NOT NULL CHECK (period_half IN (1, 2)),
        semester_id          uuid REFERENCES semesters(id),
        planned_advance_date date,
        submission_deadline  date,
        status               text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','OPEN','CLOSED')),
        CHECK (start_date <= end_date),
        CONSTRAINT ck_dtr_periods_semi_monthly CHECK (
          (period_half = 1 AND extract(day FROM start_date) = 1 AND end_date = start_date + 14)
          OR
          (period_half = 2 AND extract(day FROM start_date) = 16
                           AND extract(day FROM end_date + 1) = 1
                           AND end_date - start_date BETWEEN 12 AND 15)
        ),
        CONSTRAINT ck_dtr_periods_planned_advance CHECK (planned_advance_date IS NULL OR
          (planned_advance_date >= start_date AND planned_advance_date < end_date)),
        CONSTRAINT ex_dtr_periods_no_overlap
          EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&)
      )`);

    await q.query(`
      CREATE TABLE calendar_events (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_date         date NOT NULL,
        type               text NOT NULL CHECK (type IN ('REGULAR_HOLIDAY','SPECIAL_NON_WORKING',
                             'SPECIAL_WORKING','WORK_SUSPENSION','CAMPUS_EVENT',
                             'GOVERNMENT_ANNOUNCEMENT')),
        name               text NOT NULL,
        start_time         time,
        end_time           time,
        scope              text NOT NULL DEFAULT 'ALL' CHECK (scope IN ('ALL','DEPARTMENTS')),
        excuses_attendance boolean NOT NULL DEFAULT true,
        reference          text,
        created_by         uuid REFERENCES users(id),
        created_at         timestamptz NOT NULL DEFAULT now(),
        -- ADR-27, D-HR-11: a government announcement is government-wide, never per department
        CHECK (type <> 'GOVERNMENT_ANNOUNCEMENT' OR scope = 'ALL')
      )`);
    await q.query(`CREATE INDEX idx_calendar_events_date ON calendar_events(event_date)`);

    await q.query(`
      CREATE TABLE calendar_event_departments (
        calendar_event_id uuid REFERENCES calendar_events(id),
        department_id     uuid REFERENCES departments(id),
        PRIMARY KEY (calendar_event_id, department_id)
      )`);

    await q.query(`GRANT SELECT, INSERT, UPDATE ON academic_years TO app_user`);
    await q.query(`GRANT SELECT, INSERT, UPDATE ON semesters TO app_user`);
    // Periods are closed, never deleted: DTRs and ledgers point at them.
    await q.query(`GRANT SELECT, INSERT, UPDATE ON dtr_periods TO app_user`);
    // Calendar events are mutable (DATABASE-MAPPING §12); a change marks affected days stale.
    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_events TO app_user`);
    await q.query(`GRANT SELECT, INSERT, DELETE ON calendar_event_departments TO app_user`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE calendar_event_departments`);
    await q.query(`DROP TABLE calendar_events`);
    await q.query(`DROP TABLE dtr_periods`);
    await q.query(`DROP TABLE semesters`);
    await q.query(`DROP TABLE academic_years`);
  }
}
