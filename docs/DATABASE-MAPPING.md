---
title: CVSU DTR — Database Mapping
version: 3.0
status: draft
updated: 2026-10-05
database: PostgreSQL 16+
orm: TypeORM (migrations only; synchronize = false)
---

# CVSU DTR — Database Mapping

Related: [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] · [[CVSU-DTR/v3/MODULES|MODULES]] · [[CVSU-DTR/v3/API-DESIGN|API-DESIGN]]

> The DDL below is **normative for structure and constraints**. Column types can be adjusted in migrations, but constraints marked 🔒 are integrity guarantees and must not be dropped.

> [!info] What changed in v3 (from HR's requirements, see [[CVSU-DTR/HR-Requirements-Analysis|HR-Requirements-Analysis]] §8 and [[CVSU-DTR/v3/README|README]] ADR-21 to ADR-32)
> v3 is a fresh design, so the changes are written into the `CREATE TABLE` statements below (no `ALTER`s).
> - `dtr_periods`: **semi-monthly** (`period_half`, CHECK on 1–15 / 16–end), `planned_advance_date` (ADR-21, ADR-22)
> - `calendar_events`: type `GOVERNMENT_ANNOUNCEMENT`, `scope = 'ALL'` only (ADR-27)
> - `employee_schedules`: status `ENDORSED`, `endorsed_by/at`, maker-checker CHECKs (ADR-28)
> - `attendance_exceptions`: types `ASYNCHRONOUS`, `OFFSET`, `WELLNESS`, `MAKE_UP_CLASS`; scope `SCHEDULE_BLOCK`; `auto_approved`; status `ENDORSED` with endorsement columns and `rejected_level`; CHECKs for wellness whole-day and the make-up letter (ADR-27, ADR-28, ADR-30, ADR-31)
> - **New** `makeup_class_details` (ADR-31), `offset_earning_requests` + `offset_ledger` (ADR-29)
> - `processing_jobs`: `processing_type` (`FULL` / `ADVANCE` / `RECONCILIATION`), `processed_until`, `import_batch_id` (ADR-22, ADR-24)
> - `processed_attendance`: `attendance_basis`, `exception_ids`, status `ADVANCE_CREDIT` (ADR-22, ADR-26)
> - **New** `advance_credits` + append-only `advance_credit_events`. These are **ledgers**, not rebuilt by reprocessing (ADR-23, ADR-24, ADR-25).
> - `dtrs`: `half_days_absent`, `advance_credit_minutes`, `prior_period_adjustment_minutes`. `dtr_items`: `day_status = 'ADVANCE_CREDIT'`, `attendance_basis`, `slot_sources` (ADR-22, ADR-25).

---

## 1. Conventions

| Item | Convention |
|---|---|
| Names | `snake_case`, plural table names, FK = `<entity>_id` |
| Period FK | Always **`dtr_period_id`** |
| PK | `id uuid DEFAULT gen_random_uuid()` (audit log uses `bigint identity`) |
| Business IDs | Separate and unique (`employee_number`, `code`) |
| Enums | `text` + `CHECK` (easier to migrate than PG enums). Values mirrored in `packages/shared` |
| Audit columns | `created_at`, `updated_at` (`timestamptz`), and `created_by` / `updated_by` where a human acts |
| Deletion | Master data is **deactivated** (`status`). Historical tables are append-only or `ON DELETE RESTRICT` |
| Extensions | `pgcrypto` (or PG13+ built-in `gen_random_uuid`), `citext`, `btree_gist` |

---

## 2. Entity overview

```
users ─┬─ user_roles
       ├─ user_department_scopes ── departments
       ├─ refresh_tokens / password_reset_tokens
       └─ employees (0..1) ── departments
               │
               ├── employee_biometric_ids ── biometric_devices
               ├── employee_schedules ── schedule_blocks        (semesters)
               ├── attendance_exceptions ─┬─ schedule_blocks (optional, scope SCHEDULE_BLOCK)
               │                          └─ makeup_class_details (0..1, MAKE_UP_CLASS)    [v3]
               ├── offset_earning_requests ── offset_ledger (per semester, append-only)   [v3]
               ├── processed_attendance ── attendance_rule_sets
               ├── advance_credits ── advance_credit_events (append-only)               [v3]
               │        ├─ processing_jobs (ADVANCE run that created it)
               │        ├─ processed_attendance (actual result, after reconciliation)
               │        └─ dtr_periods (credit period, applied_in period)
               └── dtrs ─┬─ dtr_items
                         ├─ dtr_status_history
                         └─ dtr_documents ── stored_files

academic_years ── semesters ── dtr_periods (semi-monthly: 1–15, 16–end)
calendar_events ── calendar_event_departments

biometric_devices ── attendance_import_batches ─┬─ attendance_import_staging (temporary)
                                                ├─ attendance_import_errors
                                                └─ raw_attendance_records (append-only)

processing_jobs (FULL | ADVANCE | RECONCILIATION), audit_logs, stored_files, schedule_templates
```

**Ledgers vs derived data (ADR-23).** `processed_attendance` is derived and rebuildable (ADR-04). `advance_credits`, `advance_credit_events`, `offset_ledger` and the outcome columns of `makeup_class_details` record **decisions made at a point in time**. Reprocessing never deletes or rebuilds them.

---

## 3. Time and timezone rules

| Value | Type | Rule |
|---|---|---|
| Instants (punches, created_at, finalized_at) | `timestamptz` | Stored in UTC by PostgreSQL |
| Device export times (no zone) | → `timestamptz` | Interpreted as **Asia/Manila** by the parser |
| Business date of a punch | `date` (`punch_date`) | Computed by the app as the Manila local date |
| Schedule times, DTR slot times | `time` | Local wall-clock time; no midnight crossing (Phase 1) |
| Calendar dates | `date` | — |

Set the DB session `TimeZone = 'UTC'`. Only the `BusinessCalendar` service converts to Manila time.

---

## 4. Users, roles, auth

```sql
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext NOT NULL UNIQUE,
  password_hash      text,                       -- null while INVITED
  status             text NOT NULL DEFAULT 'INVITED'
                     CHECK (status IN ('INVITED','ACTIVE','INACTIVE','LOCKED')),
  failed_login_count int  NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  last_login_at      timestamptz,
  password_changed_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id    uuid NOT NULL REFERENCES users(id),
  role       text NOT NULL CHECK (role IN
             ('SYSTEM_ADMIN','HR_ADMIN','HR_STAFF','DEPARTMENT_HEAD','EMPLOYEE')),
  granted_by uuid REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

-- Which departments an HR_STAFF / DEPARTMENT_HEAD may act on. HR_ADMIN is global.
-- Ordering: references departments (§5), so it is created in 0002_org_and_devices.
CREATE TABLE user_department_scopes (
  user_id       uuid NOT NULL REFERENCES users(id),
  department_id uuid NOT NULL REFERENCES departments(id),
  PRIMARY KEY (user_id, department_id)
);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  family_id   uuid NOT NULL,                 -- rotation chain; reuse ⇒ revoke family
  token_hash  text NOT NULL UNIQUE,          -- SHA-256 of the opaque token
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid REFERENCES refresh_tokens(id),
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE password_reset_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  purpose    text NOT NULL CHECK (purpose IN ('INVITE','RESET')),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
```

---

## 5. Organization, academic calendar, schedules

```sql
CREATE TABLE departments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  campus     text,                                  -- multi-campus later
  status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

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
);
CREATE INDEX idx_employees_department ON employees(department_id);

CREATE TABLE biometric_devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,              -- e.g. 'MAIN-ADMIN-01'
  name          text NOT NULL,
  location      text,
  model         text DEFAULT 'ZKTeco MB20',
  serial_number text UNIQUE,
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);

-- 🔒 One biometric ID on one device maps to at most one employee at any date.
CREATE TABLE employee_biometric_ids (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id          uuid NOT NULL REFERENCES employees(id),
  device_id            uuid NOT NULL REFERENCES biometric_devices(id),
  biometric_identifier text NOT NULL,
  valid_from           date NOT NULL,
  valid_to             date,                                   -- null = open
  created_by           uuid REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from <= valid_to),
  EXCLUDE USING gist (
    device_id WITH =, biometric_identifier WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&)
);
-- v3 (ADR-24): reconciliation scope = employees mapped to the import batch's device
CREATE INDEX idx_biometric_ids_employee ON employee_biometric_ids(employee_id, device_id);

CREATE TABLE academic_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,                         -- '2026-2027'
  start_date date NOT NULL, end_date date NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  CHECK (start_date < end_date)
);

CREATE TABLE semesters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id uuid NOT NULL REFERENCES academic_years(id),
  code text NOT NULL CHECK (code IN ('FIRST','SECOND','MIDYEAR')),
  start_date date NOT NULL, end_date date NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  UNIQUE (academic_year_id, code),
  CHECK (start_date < end_date)
);

-- 🔒 DTR periods never overlap. semester_id is informational (a period may straddle semesters).
-- v3 (ADR-21): periods are SEMI-MONTHLY for all employees: half 1 = day 1–15, half 2 = day 16–end of month.
-- Two rows per month; each period is printed on its own CSC Form 48.
CREATE TABLE dtr_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,                                -- 'Oct 2026 (1–15)', 'Oct 2026 (16–31)'
  start_date date NOT NULL, end_date date NOT NULL,
  period_half smallint NOT NULL CHECK (period_half IN (1, 2)),   -- 1 = 1–15, 2 = 16–end
  semester_id uuid REFERENCES semesters(id),
  planned_advance_date date,                         -- HR's "cutoff" (Q-P2): planned advance run, ~2–3 days
                                                     -- before end_date. Informational; HR picks the real
                                                     -- processed_until on the job (ADR-22).
  submission_deadline date,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','OPEN','CLOSED')),
  CHECK (start_date <= end_date),
  -- 🔒 semi-monthly shape (ADR-21)
  CHECK (
    (period_half = 1 AND extract(day FROM start_date) = 1  AND end_date = start_date + 14)
    OR
    (period_half = 2 AND extract(day FROM start_date) = 16
                     AND extract(day FROM end_date + 1) = 1          -- end_date = last day of the month
                     AND end_date - start_date BETWEEN 12 AND 15)    -- same month (Feb 16–28 … 16–31)
  ),
  CHECK (planned_advance_date IS NULL OR
         (planned_advance_date >= start_date AND planned_advance_date < end_date)),
  EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&)
);

CREATE TABLE calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date date NOT NULL,
  type text NOT NULL CHECK (type IN ('REGULAR_HOLIDAY','SPECIAL_NON_WORKING',
        'SPECIAL_WORKING','WORK_SUSPENSION','CAMPUS_EVENT',
        'GOVERNMENT_ANNOUNCEMENT')),                 -- v3 (ADR-27): credited using schedule time
  name text NOT NULL,
  start_time time,                                   -- suspension / announcement from … (partial day)
  end_time   time,
  scope text NOT NULL DEFAULT 'ALL' CHECK (scope IN ('ALL','DEPARTMENTS')),
  excuses_attendance boolean NOT NULL DEFAULT true,
  reference text,                                    -- proclamation / memo no.
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- v3 (ADR-27, D-HR-11): a government announcement is government-wide, never per department
  CHECK (type <> 'GOVERNMENT_ANNOUNCEMENT' OR scope = 'ALL')
);
CREATE INDEX idx_calendar_events_date ON calendar_events(event_date);
CREATE TABLE calendar_event_departments (
  calendar_event_id uuid REFERENCES calendar_events(id),
  department_id     uuid REFERENCES departments(id),
  PRIMARY KEY (calendar_event_id, department_id)
);

CREATE TABLE schedule_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  blocks jsonb NOT NULL,                             -- [{dayOfWeek, startTime, endTime}]
  status text NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE employee_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  semester_id uuid NOT NULL REFERENCES semesters(id),
  effective_from date NOT NULL,
  effective_to   date NOT NULL,
  -- v3 (ADR-28): DRAFT → SUBMITTED → ENDORSED (Department Head / Dean) → APPROVED (HR)
  -- or, HR only (Phase 1, v2 behaviour): DRAFT → APPROVED directly by HR (approved_directly, audited)
  status text NOT NULL DEFAULT 'DRAFT'
         CHECK (status IN ('DRAFT','SUBMITTED','ENDORSED','APPROVED','REJECTED','SUPERSEDED')),
  version int NOT NULL DEFAULT 1,
  approved_directly boolean NOT NULL DEFAULT false,  -- HR created + approved it without the workflow
  submitted_at timestamptz,
  endorsed_by uuid REFERENCES users(id),             -- level 1: DEPARTMENT_HEAD (a Dean acts through this role)
  endorsed_at timestamptz,
  reviewed_by uuid REFERENCES users(id),             -- level 2: HR (approve / reject)
  reviewed_at timestamptz,
  review_remarks text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_from <= effective_to),
  CHECK ((endorsed_by IS NULL) = (endorsed_at IS NULL)),
  CHECK (status <> 'ENDORSED' OR endorsed_by IS NOT NULL),
  -- Direct HR approval skips the workflow entirely (one HR user may create and approve; audited)
  CHECK (NOT approved_directly OR (status IN ('APPROVED','SUPERSEDED')
                                   AND submitted_at IS NULL AND endorsed_by IS NULL)),
  -- Anything past DRAFT that wasn't approved directly went through submission
  CHECK (status = 'DRAFT' OR approved_directly OR submitted_at IS NOT NULL),
  -- 🔒 maker-checker at every level of the workflow (ADR-28)
  CHECK (endorsed_by IS NULL OR endorsed_by <> created_by),
  CHECK (approved_directly OR reviewed_by IS NULL OR reviewed_by <> created_by),
  CHECK (endorsed_by IS NULL OR reviewed_by IS NULL OR endorsed_by <> reviewed_by),
  -- Whether a given change must pass ENDORSED before APPROVED, and who may approve directly
  -- (HR roles only), are domain rules (BUSINESS-RULES §6).
  -- 🔒 at most one APPROVED schedule per employee per date
  EXCLUDE USING gist (employee_id WITH =,
          daterange(effective_from, effective_to, '[]') WITH &&)
          WHERE (status = 'APPROVED')
);

CREATE TABLE schedule_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_schedule_id uuid NOT NULL REFERENCES employee_schedules(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),  -- ISO: 1 = Monday
  block_no    smallint NOT NULL CHECK (block_no >= 1),
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  CHECK (start_time < end_time),
  UNIQUE (employee_schedule_id, day_of_week, block_no)
);
-- Non-overlap of blocks within a day is validated in the domain (ScheduleValidator).
-- ON DELETE CASCADE applies only to DRAFT schedules (deleting approved ones is blocked in the app).
```

**Superseding:** when a new version is approved with `effective_from = D`, the previous approved schedule gets `effective_to = D − 1`. If that would make it empty, it becomes `SUPERSEDED`. Both happen in one transaction.

---

## 6. Import and raw punches

```sql
CREATE TABLE stored_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('ATTENDANCE_IMPORT','EMPLOYEE_IMPORT',
          'DTR_PDF','EXCEPTION_ATTACHMENT','REPORT_EXPORT')),
  original_name text NOT NULL,
  storage_provider text NOT NULL CHECK (storage_provider IN ('LOCAL','S3')),
  storage_key text NOT NULL UNIQUE,                  -- never a user-supplied path
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 char(64) NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE attendance_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES biometric_devices(id),
  source_type text NOT NULL CHECK (source_type IN ('FILE_XLSX','FILE_CSV','DEVICE_SYNC')),
  file_id uuid REFERENCES stored_files(id),
  file_sha256 char(64),                               -- duplicate-file WARNING only
  parser_name text, parser_version text,
  status text NOT NULL DEFAULT 'UPLOADED' CHECK (status IN
         ('UPLOADED','VALIDATING','VALIDATED','REJECTED','COMMITTED','DISCARDED','FAILED')),
  detected_date_from date, detected_date_to date,
  total_rows int, valid_rows int, invalid_rows int,
  new_punches int, duplicate_punches int, unmatched_identifiers int,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  committed_by uuid REFERENCES users(id),
  committed_at timestamptz,
  error_message text
);
CREATE INDEX idx_import_batches_sha ON attendance_import_batches(file_sha256);

-- Parsed rows waiting for commit; purged after COMMITTED/DISCARDED (+7 days).
CREATE TABLE attendance_import_staging (
  import_batch_id uuid NOT NULL REFERENCES attendance_import_batches(id) ON DELETE CASCADE,
  row_number int NOT NULL,
  biometric_identifier text NOT NULL,
  punched_at timestamptz NOT NULL,
  punch_date date NOT NULL,
  raw_state text,
  raw_payload jsonb NOT NULL,
  PRIMARY KEY (import_batch_id, row_number)
);

CREATE TABLE attendance_import_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id uuid NOT NULL REFERENCES attendance_import_batches(id),
  row_number int,
  error_code text NOT NULL,       -- INVALID_DATE, INVALID_TIME, MISSING_COLUMN, EMPTY_IDENTIFIER, OUT_OF_RANGE …
  error_message text NOT NULL,
  raw_data jsonb
);

-- 🔒 APPEND-ONLY evidence. No employee_id: matching happens at processing time.
CREATE TABLE raw_attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id uuid NOT NULL REFERENCES attendance_import_batches(id),
  device_id uuid NOT NULL REFERENCES biometric_devices(id),
  biometric_identifier text NOT NULL,
  punched_at timestamptz NOT NULL,
  punch_date date NOT NULL,                          -- Manila local date (set by app)
  raw_state text,                                    -- device in/out state; informational only
  raw_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- 🔒 record-level dedup across overlapping exports
  UNIQUE (device_id, biometric_identifier, punched_at)
);
CREATE INDEX idx_raw_ident_date ON raw_attendance_records(device_id, biometric_identifier, punch_date);
CREATE INDEX idx_raw_batch      ON raw_attendance_records(import_batch_id);

-- 🔒 Enforce immutability at the database level
REVOKE UPDATE, DELETE, TRUNCATE ON raw_attendance_records FROM app_user;
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
CREATE TRIGGER trg_raw_immutable BEFORE UPDATE OR DELETE ON raw_attendance_records
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
-- Retention purge (SECURITY-PRIVACY §6) runs as a separate privileged role that disables the trigger in a controlled job.
```

**Commit** = `INSERT INTO raw_attendance_records … SELECT … FROM attendance_import_staging ON CONFLICT DO NOTHING`, in chunks of about 5,000 rows, inside a transaction per batch. `new_punches` = inserted count and `duplicate_punches` = the rest.

**Unmatched identifiers view:**
```sql
CREATE VIEW v_unmatched_identifiers AS
SELECT r.device_id, r.biometric_identifier,
       count(*) AS punches, min(r.punch_date) AS first_date, max(r.punch_date) AS last_date
FROM raw_attendance_records r
WHERE NOT EXISTS (
  SELECT 1 FROM employee_biometric_ids m
  WHERE m.device_id = r.device_id
    AND m.biometric_identifier = r.biometric_identifier
    AND r.punch_date BETWEEN m.valid_from AND COALESCE(m.valid_to, 'infinity'))
GROUP BY r.device_id, r.biometric_identifier;
```

---

## 7. Rule sets and exceptions

```sql
CREATE TABLE attendance_rule_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,                                  -- 'NON_TEACHING_STD'
  version int NOT NULL,
  applies_to_category text,                            -- null = all
  applies_to_employment_type text,                     -- null = all
  effective_from date NOT NULL,
  effective_to date,
  config jsonb NOT NULL,                               -- BUSINESS-RULES §5.1
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  published_by uuid REFERENCES users(id),
  published_at timestamptz,
  UNIQUE (code, version)
);
-- 🔒 PUBLISHED rule sets are immutable (trigger blocks UPDATE of config/effective_from when status = 'PUBLISHED').

-- v3 reasons (ADR-27): ASYNCHRONOUS (HR-entered, whole day, auto-approved), OFFSET, WELLNESS,
-- MAKE_UP_CLASS. GOVERNMENT_ANNOUNCEMENT is a calendar_events type, not an exception.
-- Approval (ADR-28): OFFSET / WELLNESS = PENDING → ENDORSED (Head/Dean) → APPROVED (HR);
-- MAKE_UP_CLASS = Head/Dean only (reviewed_by, no endorsement). Rules: BUSINESS-RULES §8.
CREATE TABLE attendance_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  type text NOT NULL CHECK (type IN ('LEAVE','OFFICIAL_BUSINESS','OFFICIAL_TIME',
        'TIME_CORRECTION','MISSING_PUNCH_CERTIFICATION','SCHEDULE_OVERRIDE','MANUAL_REMARK',
        'ASYNCHRONOUS','OFFSET','WELLNESS','MAKE_UP_CLASS')),                       -- v3
  subtype text,                                        -- VL, SL, SPL …
  date_from date NOT NULL,
  date_to   date NOT NULL,
  scope text NOT NULL CHECK (scope IN ('WHOLE_DAY','AM','PM','SLOT','TIME_RANGE',
        'SCHEDULE_BLOCK')),                            -- v3: one schedule entry
  slot text CHECK (slot IN ('AM_IN','AM_OUT','PM_IN','PM_OUT')),
  time_value time,                                     -- for SLOT corrections
  time_from time, time_to time,                        -- for TIME_RANGE
  override_blocks jsonb,                               -- for SCHEDULE_OVERRIDE
  schedule_block_id uuid REFERENCES schedule_blocks(id),   -- v3: for scope SCHEDULE_BLOCK (§5)
  reason text NOT NULL,
  attachment_file_id uuid REFERENCES stored_files(id), -- MAKE_UP_CLASS: the letter (required)
  auto_approved boolean NOT NULL DEFAULT false,        -- v3: ASYNCHRONOUS is created APPROVED by HR (audited)
  status text NOT NULL DEFAULT 'PENDING'
         CHECK (status IN ('PENDING','ENDORSED','APPROVED','REJECTED','CANCELLED','REVOKED')),
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  endorsed_by uuid REFERENCES users(id),               -- v3 level 1: DEPARTMENT_HEAD (Dean)
  endorsed_at timestamptz,
  endorse_remarks text,
  reviewed_by uuid REFERENCES users(id),               -- final approver / rejecter
  reviewed_at timestamptz,
  review_remarks text,
  rejected_level text CHECK (rejected_level IN ('DEPARTMENT','HR')),   -- v3: which level rejected
  revoked_by uuid REFERENCES users(id),
  revoked_at timestamptz,
  revoke_reason text,
  CHECK (date_from <= date_to),
  CHECK (scope <> 'SLOT' OR (slot IS NOT NULL AND time_value IS NOT NULL)),
  CHECK ((scope = 'SCHEDULE_BLOCK') = (schedule_block_id IS NOT NULL)),
  CHECK ((endorsed_by IS NULL) = (endorsed_at IS NULL)),
  CHECK (status <> 'ENDORSED' OR endorsed_by IS NOT NULL),
  CHECK ((status = 'REJECTED') = (rejected_level IS NOT NULL)),
  CHECK (reviewed_by IS NULL OR reviewed_by <> requested_by),       -- 🔒 maker-checker (approver)
  CHECK (endorsed_by IS NULL OR endorsed_by <> requested_by),       -- 🔒 maker-checker (endorser, ADR-28)
  CHECK (endorsed_by IS NULL OR reviewed_by IS NULL OR endorsed_by <> reviewed_by),  -- two different people
  CHECK (type NOT IN ('WELLNESS','ASYNCHRONOUS') OR scope = 'WHOLE_DAY'),          -- ADR-30, ADR-27
  CHECK (type <> 'MAKE_UP_CLASS' OR attachment_file_id IS NOT NULL)  -- 🔒 letter required (ADR-31)
  -- Enforced in the DOMAIN, not here (they need aggregates over other rows):
  --   • WELLNESS ≤ 4 whole days per academic year (approved + pending + requested), checked at
  --     endorsement and approval → WELLNESS_LIMIT_REACHED (ADR-30)
  --   • OFFSET minutes ≤ offset balance of the semester (SUM(offset_ledger.minutes)), checked at
  --     approval → OFFSET_BALANCE_INSUFFICIENT (ADR-29)
  --   • which types need endorsement; schedule_block_id belongs to the employee's approved schedule
);
CREATE INDEX idx_exceptions_emp_date ON attendance_exceptions(employee_id, date_from, date_to)
  WHERE status = 'APPROVED';
CREATE INDEX idx_exceptions_queue ON attendance_exceptions(status, requested_at)
  WHERE status IN ('PENDING','ENDORSED');                       -- endorsement / approval inboxes
CREATE INDEX idx_exceptions_wellness ON attendance_exceptions(employee_id, date_from)
  WHERE type = 'WELLNESS' AND status IN ('PENDING','ENDORSED','APPROVED');   -- 4-day limit count

-- v3 (ADR-31): make-up class. Keeps the original and the make-up date traceable.
-- Ordering: references processed_attendance (§8), so it is created in migration 0009 (§13).
CREATE TABLE makeup_class_details (
  exception_id               uuid PRIMARY KEY REFERENCES attendance_exceptions(id),  -- type MAKE_UP_CLASS
  original_date              date NOT NULL,          -- missed date: ABSENT until the letter is approved
  original_schedule_block_id uuid NOT NULL REFERENCES schedule_blocks(id),
  makeup_date                date NOT NULL,          -- may fall in a later DTR period
  makeup_start_time          time NOT NULL,          -- evaluated like a schedule block (tardy / undertime)
  makeup_end_time            time NOT NULL,
  makeup_room                text,
  -- Outcome: set by the system once an import covering makeup_date (date range + the employee's
  -- device, ADR-24) is committed. Decision ledger (ADR-23): not rebuilt by reprocessing.
  outcome text NOT NULL DEFAULT 'PENDING'
          CHECK (outcome IN ('PENDING','ATTENDED','PARTIAL','NOT_ATTENDED')),
  outcome_processed_attendance_id uuid REFERENCES processed_attendance(id) ON DELETE SET NULL,
  reversal_minutes int NOT NULL DEFAULT 0 CHECK (reversal_minutes <= 0),   -- the make-up's own net reversal
  applied_in_dtr_period_id uuid REFERENCES dtr_periods(id),  -- informational: where the reversal was
                                                             -- carried. NULL = original date's DTR not yet
                                                             -- finalized, so it was just recalculated.
                                                             -- The carried amount lives in
                                                             -- carry_forward_adjustments (§8.2, ADR-25).
  outcome_at timestamptz,
  CHECK (makeup_start_time < makeup_end_time),
  CHECK (makeup_date <> original_date),
  CHECK (outcome = 'PENDING' OR outcome_at IS NOT NULL)
  -- Domain: original_date = exception.date_from = date_to; the block belongs to the employee's schedule.
  -- O-7 (open): PARTIAL is tardy/undertime on makeup_date only; reversal_minutes stays 0.
);
CREATE INDEX idx_makeup_date ON makeup_class_details(makeup_date);   -- import commit: makeup_date in the
                                                                      -- batch range (incl. re-evaluation)

-- v3 (ADR-29): earned offset hours (work outside the schedule), approved by the Head/Dean (one level).
CREATE TABLE offset_earning_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  semester_id uuid NOT NULL REFERENCES semesters(id),          -- expiry = semester end_date
  work_date date NOT NULL,
  time_from time NOT NULL,
  time_to   time NOT NULL,
  minutes   int  NOT NULL CHECK (minutes > 0),
  reason    text NOT NULL,                                     -- weekend / holiday / beyond-schedule work
  attachment_file_id uuid REFERENCES stored_files(id),
  status text NOT NULL DEFAULT 'PENDING'
         CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users(id),                       -- DEPARTMENT_HEAD (Dean)
  reviewed_at timestamptz,
  review_remarks text,
  CHECK (time_from < time_to),
  CHECK (minutes <= (EXTRACT(EPOCH FROM (time_to - time_from)) / 60)),
  CHECK (status NOT IN ('APPROVED','REJECTED') OR reviewed_by IS NOT NULL),
  CHECK (reviewed_by IS NULL OR reviewed_by <> requested_by)   -- 🔒 maker-checker
  -- Domain: work_date within the semester; the approval screen shows the raw punches of work_date (O-5).
);
CREATE INDEX idx_offset_earning_emp_sem ON offset_earning_requests(employee_id, semester_id);
CREATE INDEX idx_offset_earning_queue   ON offset_earning_requests(status, requested_at)
  WHERE status = 'PENDING';

-- v3 (ADR-29): 🔒 APPEND-ONLY offset ledger. Corrections are new rows (REVERSED), never edits.
-- Balance = SUM(minutes) per (employee_id, semester_id). An OFFSET exception draws from the
-- semester of its date. A semester-end job writes one EXPIRED row (−remaining balance).
CREATE TABLE offset_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  semester_id uuid NOT NULL REFERENCES semesters(id),          -- validity window
  entry_type text NOT NULL CHECK (entry_type IN ('EARNED','USED','EXPIRED','REVERSED')),
  minutes int NOT NULL,                                        -- + earned / restored, − used / expired
  offset_earning_request_id uuid REFERENCES offset_earning_requests(id),   -- EARNED
  exception_id uuid REFERENCES attendance_exceptions(id),      -- USED (the OFFSET request), or REVERSED on revoke
  source_reference text,                                       -- free-text note
  created_by uuid REFERENCES users(id),                        -- null = system (expiry job)
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (minutes <> 0),
  CHECK (entry_type <> 'EARNED'  OR (minutes > 0 AND offset_earning_request_id IS NOT NULL)),
  CHECK (entry_type <> 'USED'    OR (minutes < 0 AND exception_id IS NOT NULL)),
  CHECK (entry_type <> 'EXPIRED' OR minutes < 0)
);
CREATE INDEX idx_offset_ledger_emp_sem ON offset_ledger(employee_id, semester_id);
CREATE UNIQUE INDEX uq_offset_earned  ON offset_ledger(offset_earning_request_id) WHERE entry_type = 'EARNED';
CREATE UNIQUE INDEX uq_offset_used    ON offset_ledger(exception_id)              WHERE entry_type = 'USED';
CREATE UNIQUE INDEX uq_offset_expired ON offset_ledger(employee_id, semester_id)  WHERE entry_type = 'EXPIRED';
REVOKE UPDATE, DELETE, TRUNCATE ON offset_ledger FROM app_user;                     -- 🔒 append-only
CREATE TRIGGER trg_offset_ledger_immutable BEFORE UPDATE OR DELETE ON offset_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();                                  -- function from §6
```

The balance check and the ledger insert run in one transaction under `pg_advisory_xact_lock(hashtext('offset:' || employee_id || ':' || semester_id))`, so two approvals can't overdraw the same balance. Rules: [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] §8.

---

## 8. Processed attendance and jobs

```sql
-- Job history. Kept (never deleted): advance_credits / advance_credit_events reference it.
-- v3 (ADR-22, ADR-24) processing types:
--   FULL           whole period from actual data (processed_until IS NULL = through end_date)
--   ADVANCE        actual data up to processed_until; dates after it get advance credit
--   RECONCILIATION re-evaluates advance credits (and make-up outcomes) against actual data.
--                  Started automatically by an import commit (import_batch_id set), by a late
--                  exception approval, or manually (import_batch_id NULL). An import covers a credit
--                  only if detected_date_from ≤ credit_date ≤ detected_date_to AND the employee is
--                  mapped to the batch's device on that date (employee_biometric_ids). Credits that
--                  are already RECONCILED / ADJUSTED / REVERSED are re-evaluated too, so a later
--                  import with punches can restore a reversal (ADR-24).
CREATE TABLE processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dtr_period_id uuid NOT NULL REFERENCES dtr_periods(id),
  processing_type text NOT NULL DEFAULT 'FULL'
                  CHECK (processing_type IN ('FULL','ADVANCE','RECONCILIATION')),
  processed_until date,                                -- ADVANCE only: last date taken from actual data
  import_batch_id uuid REFERENCES attendance_import_batches(id),   -- RECONCILIATION after an import commit
  scope jsonb NOT NULL DEFAULT '{}',                   -- {employeeIds?, departmentId?}
  status text NOT NULL DEFAULT 'QUEUED'
         CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
  requested_by uuid NOT NULL REFERENCES users(id),     -- automatic runs: the user who committed the
                                                       -- import / approved the exception
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz, finished_at timestamptz,
  summary jsonb, error_message text,                   -- RECONCILIATION summary: counts per outcome,
                                                       -- e.g. "142 credits reversed for Sept 15"
  CHECK ((processing_type = 'ADVANCE') = (processed_until IS NOT NULL)),
  CHECK (import_batch_id IS NULL OR processing_type = 'RECONCILIATION')
  -- 🔒 Guard (cross-table, BEFORE INSERT trigger trg_processing_jobs_guard + domain check):
  --    period.start_date ≤ processed_until < period.end_date   (ADR-22)
);
CREATE INDEX idx_jobs_period ON processing_jobs(dtr_period_id, queued_at DESC);

-- Derived data: may be rebuilt for unlocked dates (ADR-04). Rebuild = upsert
-- ON CONFLICT (employee_id, work_date) DO UPDATE, so ids are stable; ledgers that point here use
-- ON DELETE SET NULL and keep their own snapshot values.
-- v3: a RECONCILIATION run recomputes credited dates from actual data even when the credit's DTR
-- is FINALIZED; dtr_items stay frozen and the difference becomes a carry_forward_adjustments row
-- (ADR-25). If that DTR is not finalized yet, the day is simply recalculated in it.
CREATE TABLE processed_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  work_date date NOT NULL,
  dtr_period_id uuid NOT NULL REFERENCES dtr_periods(id),
  employee_schedule_id uuid REFERENCES employee_schedules(id),
  rule_set_id uuid NOT NULL REFERENCES attendance_rule_sets(id),
  am_in time, am_out time, pm_in time, pm_out time,
  -- Origin of each slot: PUNCH (biometrics), CORRECTION (approved TIME_CORRECTION / certification),
  -- SCHEDULE (approved reason or calendar event, ADR-27), ADVANCE (advance credit, ADR-22).
  slot_sources jsonb NOT NULL DEFAULT '{}',            -- {"am_in":"PUNCH","pm_out":"SCHEDULE", …}
  -- v3 (ADR-26): ACTUAL = biometrics · SCHEDULE_DERIVED = schedule times from an approved reason ·
  -- ADVANCE = date after processed_until · MIXED = some blocks actual, some derived
  attendance_basis text NOT NULL DEFAULT 'ACTUAL'
                   CHECK (attendance_basis IN ('ACTUAL','SCHEDULE_DERIVED','ADVANCE','MIXED')),
  exception_ids uuid[] NOT NULL DEFAULT '{}',          -- v3: approved exceptions applied to this day
  scheduled_minutes int NOT NULL DEFAULT 0,
  worked_minutes    int NOT NULL DEFAULT 0,
  tardy_minutes     int NOT NULL DEFAULT 0,
  early_out_minutes int NOT NULL DEFAULT 0,
  undertime_minutes int NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('NO_SCHEDULE','REST_DAY','HOLIDAY','SUSPENDED',
         'ON_LEAVE','OFFICIAL_BUSINESS','ABSENT','HALF_DAY_ABSENT','INCOMPLETE',
         'LATE_UNDERTIME','LATE','UNDERTIME','PRESENT',
         'ADVANCE_CREDIT')),                           -- v3: full scheduled minutes, slots from schedule
  flags text[] NOT NULL DEFAULT '{}',
  is_blocking boolean NOT NULL DEFAULT false,
  remarks text,
  used_punch_ids uuid[] NOT NULL DEFAULT '{}',         -- explainability
  ignored_punch_ids uuid[] NOT NULL DEFAULT '{}',
  input_fingerprint char(64) NOT NULL,                 -- hash of all inputs (BUSINESS-RULES §2)
  is_stale boolean NOT NULL DEFAULT false,             -- set when an input changes
  processing_job_id uuid REFERENCES processing_jobs(id),
  processed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date),
  CHECK (worked_minutes >= 0 AND tardy_minutes >= 0 AND early_out_minutes >= 0 AND undertime_minutes >= 0),
  CHECK ((status = 'ADVANCE_CREDIT') = (attendance_basis = 'ADVANCE'))
);
CREATE INDEX idx_processed_period_emp ON processed_attendance(dtr_period_id, employee_id);
CREATE INDEX idx_processed_blocking   ON processed_attendance(dtr_period_id) WHERE is_blocking;
```

### 8.1 Advance credits (v3 ledger)

> [!important] Ledgers, not derived data (ADR-23)
> `advance_credits` and `advance_credit_events` record a decision made **before** the data existed ("Sept 14 was credited on Sept 13"). Reprocessing **never** deletes or rebuilds them, and they are not part of `input_fingerprint`. Processing rules: [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] §12 (advance processing, reconciliation, carry-forward).

```sql
-- One row per employee per credited date. Created by an ADVANCE run for each date after
-- processed_until with scheduled minutes > 0 (rest days and holidays get no row).
-- State changes only through the reconciliation service, each paired with an
-- advance_credit_events row in the same transaction. Never deleted.
CREATE TABLE advance_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id          uuid NOT NULL REFERENCES employees(id),
  dtr_period_id        uuid NOT NULL REFERENCES dtr_periods(id),       -- period the credit was given in
  processing_job_id    uuid NOT NULL REFERENCES processing_jobs(id),   -- the ADVANCE run that created it
  credit_date          date NOT NULL,
  employee_schedule_id uuid NOT NULL REFERENCES employee_schedules(id), -- approved schedule used (ADR-22)
  credited_minutes     int  NOT NULL CHECK (credited_minutes > 0),     -- full scheduled minutes of the date
  status text NOT NULL DEFAULT 'ADVANCED'
         CHECK (status IN ('ADVANCED','RECONCILED','ADJUSTED','REVERSED','CANCELLED')),
  actual_processed_attendance_id uuid REFERENCES processed_attendance(id) ON DELETE SET NULL,
  actual_day_status    text,                                           -- snapshot: PRESENT, LATE, ABSENT …
  -- Signed NET adjustment = SUM(advance_credit_events.adjustment_minutes):
  -- negative = deduction, a positive event (RESTORED) brings it back toward 0.
  adjustment_minutes   int  NOT NULL DEFAULT 0,
  applied_in_dtr_period_id uuid REFERENCES dtr_periods(id),            -- period of the latest carried
                                                                       -- adjustment; NULL = absorbed by
                                                                       -- recalculating the credit's own,
                                                                       -- not yet finalized DTR (ADR-25)
  reconciliation_trigger text
         CHECK (reconciliation_trigger IN ('ADVANCE_RUN','IMPORT','EXCEPTION_APPROVED','MANUAL')),
  reconciled_by        uuid REFERENCES users(id),                      -- null = system (automatic)
  reconciled_at        timestamptz,
  remarks              text,                                           -- why adjusted
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('ADVANCED','CANCELLED')
         OR (reconciled_at IS NOT NULL AND reconciliation_trigger IS NOT NULL)),
  -- net adjustment matches the state (reference cases A02–A06)
  CHECK (status NOT IN ('ADVANCED','CANCELLED','RECONCILED') OR adjustment_minutes = 0),
  CHECK (status <> 'ADJUSTED' OR adjustment_minutes < 0),
  CHECK (status <> 'REVERSED' OR adjustment_minutes = -credited_minutes),
  -- 🔒 a carried adjustment never lands in the credit's own period: that DTR is signed (ADR-13, ADR-25)
  CHECK (applied_in_dtr_period_id IS NULL OR applied_in_dtr_period_id <> dtr_period_id)
);
-- 🔒 at most one live credit per employee per date (a second ADVANCE run reconciles, never duplicates)
CREATE UNIQUE INDEX uq_advance_credit_open
  ON advance_credits(employee_id, credit_date) WHERE status <> 'CANCELLED';
CREATE INDEX idx_advance_credit_pending           -- credits still waiting, per period (HR screens, finalize)
  ON advance_credits(dtr_period_id) WHERE status = 'ADVANCED';
CREATE INDEX idx_advance_credit_reconcile         -- import commit: credit_date BETWEEN detected_date_from
  ON advance_credits(credit_date, employee_id)    -- AND detected_date_to, live credits (incl. re-evaluation),
  WHERE status <> 'CANCELLED';                    -- joined to idx_biometric_ids_employee for the device
CREATE INDEX idx_advance_credit_emp_date          -- history lookups, incl. CANCELLED
  ON advance_credits(employee_id, credit_date);
CREATE INDEX idx_advance_credit_job               -- undo / inspect one ADVANCE run
  ON advance_credits(processing_job_id);
REVOKE DELETE, TRUNCATE ON advance_credits FROM app_user;                       -- 🔒 never deleted

-- 🔒 APPEND-ONLY history of every advance-credit change (ADR-23, D-HR-19).
-- `event` names the direction of the change, `to_status` the resulting state: e.g. a later import
-- turning REVERSED (−600) into late-by-30 is event RESTORED, +570, to_status ADJUSTED.
-- An event whose delta is carried (applied_in_dtr_period_id NOT NULL) has exactly one
-- carry_forward_adjustments row (§8.2). applied_in NULL + non-zero delta = absorbed by recalculating
-- the credit's own, not yet finalized DTR.
CREATE TABLE advance_credit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_credit_id uuid NOT NULL REFERENCES advance_credits(id),
  event text NOT NULL CHECK (event IN ('CREATED','RECONCILED','ADJUSTED','REVERSED',
                                       'RESTORED','CANCELLED')),
  from_status text,                                    -- null for CREATED
  to_status   text NOT NULL,
  adjustment_minutes int NOT NULL DEFAULT 0,           -- this event's signed delta
  trigger text NOT NULL CHECK (trigger IN ('ADVANCE_RUN','IMPORT','EXCEPTION_APPROVED','MANUAL')),
  import_batch_id   uuid REFERENCES attendance_import_batches(id),
  exception_id      uuid REFERENCES attendance_exceptions(id),
  processing_job_id uuid REFERENCES processing_jobs(id),
  applied_in_dtr_period_id uuid REFERENCES dtr_periods(id),   -- where this delta is carried (ADR-25)
  actor_user_id uuid REFERENCES users(id),             -- null = system (automatic)
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (event <> 'CREATED' OR (trigger = 'ADVANCE_RUN' AND adjustment_minutes = 0)),
  CHECK (event NOT IN ('ADJUSTED','REVERSED') OR adjustment_minutes < 0),
  CHECK (event <> 'RESTORED' OR adjustment_minutes > 0),
  CHECK (applied_in_dtr_period_id IS NULL OR adjustment_minutes <> 0),
  CHECK (trigger <> 'IMPORT' OR import_batch_id IS NOT NULL),
  CHECK (trigger <> 'EXCEPTION_APPROVED' OR exception_id IS NOT NULL)
);
CREATE INDEX idx_adv_credit_events ON advance_credit_events(advance_credit_id, created_at);
REVOKE UPDATE, DELETE, TRUNCATE ON advance_credit_events FROM app_user;          -- 🔒 append-only
CREATE TRIGGER trg_adv_credit_events_immutable BEFORE UPDATE OR DELETE ON advance_credit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();                               -- function from §6
```

### 8.2 Carry-forward adjustments (v3 ledger)

The **single ledger** for every amount carried from a finalized DTR into a later one, whatever the source (ADR-25). `dtrs.prior_period_adjustment_minutes` is derived from it (§9). A row is created **only** when the source day's DTR is already FINALIZED or later. Otherwise the day is just recalculated in its own DTR and no row is written. Rules: [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] §12.

```sql
-- 🔒 APPEND-ONLY. Corrections are new offsetting rows (e.g. MANUAL), never edits.
-- source_type:
--   ADVANCE_CREDIT  an advance_credit_events delta carried out of the credit's finalized period
--   MAKEUP_CLASS    make-up not attended: the original date's excuse is reversed (ADR-31)
--   LATE_EXCEPTION  an exception approved after its day's DTR was finalized, on a day with no advance
--                   credit: OFFSET / WELLNESS / LEAVE / OB …, or a MAKE_UP_CLASS letter (M06 +120)
--   MANUAL          HR correction (reason required, audited)
CREATE TABLE carry_forward_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id              uuid NOT NULL REFERENCES employees(id),
  source_date              date NOT NULL,                              -- the day being corrected
  source_dtr_period_id     uuid NOT NULL REFERENCES dtr_periods(id),   -- the finalized period it belongs to
  applied_in_dtr_period_id uuid NOT NULL REFERENCES dtr_periods(id),   -- next open period (ADR-25)
  minutes int NOT NULL CHECK (minutes <> 0),                           -- − deduction, + restoration
  source_type text NOT NULL
              CHECK (source_type IN ('ADVANCE_CREDIT','MAKEUP_CLASS','LATE_EXCEPTION','MANUAL')),
  advance_credit_event_id uuid REFERENCES advance_credit_events(id),
  exception_id            uuid REFERENCES attendance_exceptions(id),
  reason     text NOT NULL,                                            -- printed / shown as the remark
  created_by uuid REFERENCES users(id),                                -- null = system (automatic)
  created_at timestamptz NOT NULL DEFAULT now(),
  -- 🔒 never back into the source period: its DTR is signed (ADR-13, ADR-25)
  CHECK (applied_in_dtr_period_id <> source_dtr_period_id),
  -- the reference matches the source
  CHECK (CASE source_type
           WHEN 'ADVANCE_CREDIT' THEN advance_credit_event_id IS NOT NULL AND exception_id IS NULL
           WHEN 'MAKEUP_CLASS'   THEN exception_id IS NOT NULL AND advance_credit_event_id IS NULL
           WHEN 'LATE_EXCEPTION' THEN exception_id IS NOT NULL AND advance_credit_event_id IS NULL
           WHEN 'MANUAL'         THEN advance_credit_event_id IS NULL
         END),
  CHECK (source_type <> 'MANUAL' OR created_by IS NOT NULL)
  -- Domain: source_date lies in source_dtr_period_id; applied_in is a later period whose DTR for
  -- this employee is not FINALIZED+; for ADVANCE_CREDIT, minutes and applied_in equal the event's.
);
-- 🔒 one carried row per advance-credit event
CREATE UNIQUE INDEX uq_cfa_advance_event ON carry_forward_adjustments(advance_credit_event_id)
  WHERE advance_credit_event_id IS NOT NULL;
CREATE INDEX idx_cfa_applied     ON carry_forward_adjustments(applied_in_dtr_period_id, employee_id);  -- DTR totals
CREATE INDEX idx_cfa_emp_source  ON carry_forward_adjustments(employee_id, source_date);             -- history
CREATE INDEX idx_cfa_exception   ON carry_forward_adjustments(exception_id) WHERE exception_id IS NOT NULL;
REVOKE UPDATE, DELETE, TRUNCATE ON carry_forward_adjustments FROM app_user;      -- 🔒 append-only
CREATE TRIGGER trg_cfa_immutable BEFORE UPDATE OR DELETE ON carry_forward_adjustments
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();                               -- function from §6
```

`trigger` is a non-reserved keyword in PostgreSQL and works as a column name; quote it in hand-written SQL if your tooling complains. The audit log also gets `ADVANCE_PROCESSING_RUN` and `ADVANCE_CREDIT_CREATED / _RECONCILED / _ADJUSTED / _REVERSED / _RESTORED` entries (§10).

---

## 9. DTR

```sql
CREATE TABLE dtrs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  dtr_period_id uuid NOT NULL REFERENCES dtr_periods(id),
  version int NOT NULL DEFAULT 1,                      -- +1 on reopen
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN
         ('DRAFT','FOR_REVIEW','VALIDATED','RETURNED','FINALIZED','SUBMITTED','RECEIVED')),
  -- totals (BUSINESS-RULES §5.10)
  days_present numeric(4,1) NOT NULL DEFAULT 0,
  days_absent  numeric(4,1) NOT NULL DEFAULT 0,
  half_days_absent numeric(4,1) NOT NULL DEFAULT 0,    -- v3: was listed in BUSINESS-RULES §5.10, missing in v2
  days_on_leave numeric(4,1) NOT NULL DEFAULT 0,
  tardy_count int NOT NULL DEFAULT 0,
  tardy_minutes int NOT NULL DEFAULT 0,
  early_out_minutes int NOT NULL DEFAULT 0,
  undertime_minutes int NOT NULL DEFAULT 0,
  blocking_flag_count int NOT NULL DEFAULT 0,
  -- v3 (ADR-22, ADR-25)
  advance_credit_minutes int NOT NULL DEFAULT 0 CHECK (advance_credit_minutes >= 0),
                                                       -- derived: days printed as advance (see below)
  prior_period_adjustment_minutes int NOT NULL DEFAULT 0,
                                                       -- derived: SUM(carry_forward_adjustments.minutes)
                                                       -- applied to this period; − deduction, + restoration
  employee_remarks text,
  generated_by uuid REFERENCES users(id),   generated_at timestamptz,
  validated_by uuid REFERENCES users(id),   validated_at timestamptz,
  finalized_by uuid REFERENCES users(id),   finalized_at timestamptz,
  employee_submitted_at timestamptz,
  received_by uuid REFERENCES users(id),    received_at timestamptz,
  last_return_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, dtr_period_id)                  -- 🔒 one DTR per employee per period
);
CREATE INDEX idx_dtrs_period_status ON dtrs(dtr_period_id, status);

CREATE TABLE dtr_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dtr_id uuid NOT NULL REFERENCES dtrs(id),
  work_date date NOT NULL,
  am_in time, am_out time, pm_in time, pm_out time,    -- ADVANCE_CREDIT days: the scheduled times (ADR-22)
  undertime_hours smallint NOT NULL DEFAULT 0,
  undertime_mins  smallint NOT NULL DEFAULT 0 CHECK (undertime_mins BETWEEN 0 AND 59),
  tardy_minutes int NOT NULL DEFAULT 0,
  early_out_minutes int NOT NULL DEFAULT 0,
  worked_minutes int NOT NULL DEFAULT 0,
  day_status text NOT NULL CHECK (day_status IN ('NO_SCHEDULE','REST_DAY','HOLIDAY','SUSPENDED',
         'ON_LEAVE','OFFICIAL_BUSINESS','ABSENT','HALF_DAY_ABSENT','INCOMPLETE',
         'LATE_UNDERTIME','LATE','UNDERTIME','PRESENT',
         'ADVANCE_CREDIT')),                           -- same values as processed_attendance.status
  attendance_basis text NOT NULL DEFAULT 'ACTUAL'      -- v3 snapshot (ADR-26)
                   CHECK (attendance_basis IN ('ACTUAL','SCHEDULE_DERIVED','ADVANCE','MIXED')),
  slot_sources jsonb NOT NULL DEFAULT '{}',            -- v3 snapshot: ADVANCE on advance days
  flags text[] NOT NULL DEFAULT '{}',
  remarks text,                                        -- printed: VL, OB, HOLIDAY …; blank on advance days (ADR-22)
  rule_set_id uuid REFERENCES attendance_rule_sets(id),
  UNIQUE (dtr_id, work_date)
);
-- 🔒 Trigger: reject INSERT/UPDATE/DELETE on dtr_items when parent dtr.status IN
--    ('FINALIZED','SUBMITTED','RECEIVED'). Items are the frozen snapshot of what was printed.
--    Reconciliation never touches them: differences go to a later DTR (ADR-25).

CREATE TABLE dtr_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dtr_id uuid NOT NULL REFERENCES dtrs(id),
  dtr_version int NOT NULL,
  action text NOT NULL,                                -- generate, validate, return, finalize …
  from_status text, to_status text NOT NULL,
  actor_user_id uuid REFERENCES users(id),            -- null = system
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dtr_history_dtr ON dtr_status_history(dtr_id, created_at);

CREATE TABLE dtr_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dtr_id uuid NOT NULL REFERENCES dtrs(id),
  dtr_version int NOT NULL,
  file_id uuid NOT NULL REFERENCES stored_files(id),
  sha256 char(64) NOT NULL,                            -- printed as a short code on the PDF footer
  template_version text NOT NULL,                      -- 'CSC48-2026.1'
  status text NOT NULL DEFAULT 'CURRENT' CHECK (status IN ('CURRENT','SUPERSEDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dtr_id, dtr_version)
);
```

**Finalize transaction:** lock the `dtrs` row (`SELECT … FOR UPDATE`) → check status = VALIDATED and the maker-checker rule → copy processed rows into `dtr_items` → compute the v3 totals (below) → set FINALIZED → insert history + audit → commit. The worker then renders the PDF and inserts `dtr_documents`. The DTR is downloadable when its CURRENT document exists.

**v3 totals (ADR-22, ADR-25).** Both are **derived** and recomputed at generate and finalize time (inside the finalize transaction), for one employee and period:
- `advance_credit_minutes` = Σ `advance_credits.credited_minutes` with `dtr_period_id` = this period and `status = 'ADVANCED'`. These are the days printed as `ADVANCE_CREDIT`. A credit reconciled before finalize has already been recalculated into its day.
- `prior_period_adjustment_minutes` = Σ `carry_forward_adjustments.minutes` with `applied_in_dtr_period_id` = this period. This one ledger covers advance credits, make-up reversals and late approvals, including the M06 +120 restoration (§8.2).

A carry-forward picks the **next open** period: the first later period where the employee's DTR is not FINALIZED or later. The service locks that `dtrs` row `FOR UPDATE` (if it exists) while inserting the `carry_forward_adjustments` row, so a concurrent finalize can't miss it.

---

## 10. Audit log

```sql
CREATE TABLE audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_roles text[],
  action text NOT NULL,                  -- DTR_FINALIZED, ATTENDANCE_EXCEPTION_APPROVED, DTR_VIEWED …
                                         -- v3: EXCEPTION_ENDORSED, OFFSET_EARNED, OFFSET_EXPIRED,
                                         -- ADVANCE_PROCESSING_RUN, ADVANCE_CREDIT_*
  entity_type text NOT NULL,
  entity_id uuid,
  request_id text,
  ip inet,
  user_agent text,
  before jsonb,
  after jsonb,
  reason text,
  metadata jsonb
);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_audit_actor  ON audit_logs(actor_user_id, occurred_at DESC);
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_user;   -- 🔒 append-only
```
Partition by month (`occurred_at`) when the table passes about 10M rows.

---

## 11. Report views (examples)

```sql
CREATE VIEW v_dtr_submission_status AS
SELECT p.id AS dtr_period_id, e.department_id, d.status, count(*) AS n
FROM dtrs d
JOIN employees e ON e.id = d.employee_id
JOIN dtr_periods p ON p.id = d.dtr_period_id
GROUP BY p.id, e.department_id, d.status;
```
Others: `v_period_tardiness` (per employee: tardy_count, tardy_minutes), `v_import_log`, `v_employees_without_schedule(dtr_period_id)`.

---

## 12. Data ownership

| Table(s) | Module | Mutability |
|---|---|---|
| users, user_roles, user_department_scopes, refresh_tokens, password_reset_tokens | users / auth | mutable |
| departments, employees, employee_biometric_ids, biometric_devices | departments / employees / devices | mutable; deactivate, never delete |
| academic_years, semesters, dtr_periods | academic-periods | mutable while DRAFT/OPEN |
| calendar_events | calendar | mutable; changes mark affected days stale |
| schedule_templates, employee_schedules, schedule_blocks | schedules | workflow-controlled |
| attendance_import_* | attendance-import | staging purged; batches kept |
| raw_attendance_records | attendance | 🔒 append-only |
| attendance_rule_sets | attendance | 🔒 immutable once PUBLISHED |
| attendance_exceptions | attendance | workflow-controlled (PENDING → ENDORSED → APPROVED) |
| makeup_class_details | attendance | details workflow-controlled with the exception; outcome columns are a ledger (ADR-23), set by the system, not rebuilt |
| offset_earning_requests | attendance (offset) | workflow-controlled (Head/Dean approval) |
| offset_ledger | attendance (offset) | 🔒 append-only ledger (corrections = REVERSED rows) |
| processed_attendance | attendance (processing) | derived / rebuildable (upsert, stable ids) |
| processing_jobs | attendance (processing) | job history; kept, never deleted (ledgers reference it) |
| advance_credits | attendance (advance) | ledger: status changes only via reconciliation, 🔒 never deleted, not rebuilt (ADR-23) |
| advance_credit_events | attendance (advance) | 🔒 append-only |
| dtrs, dtr_status_history, dtr_documents, dtr_items | dtr | items 🔒 frozen from FINALIZED |
| stored_files | files | immutable content |
| audit_logs | audit | 🔒 append-only |

---

## 13. Migrations and seed data

- TypeORM migrations only. `synchronize: false` in **all** environments except throwaway local databases.
- Migration names: `0001_init_users_auth`, `0002_org_and_devices`, `0003_academic_calendar`, `0004_schedules`, `0005_import_and_raw`, `0006_rules_exceptions_processing`, `0007_dtr`, `0008_audit_and_views`, `0009_advance_and_reasons`.
- v3 placement:
  - **Column and CHECK changes** go into the migration that creates the table: `dtr_periods` and `calendar_events` → 0003, `employee_schedules` → 0004, `attendance_exceptions`, `processing_jobs` and `processed_attendance` → 0006, `dtrs` and `dtr_items` → 0007.
  - **New tables** go into `0009_advance_and_reasons`, in this order: `makeup_class_details`, `offset_earning_requests`, `offset_ledger`, `advance_credits`, `advance_credit_events`, plus their indexes, REVOKEs, `forbid_mutation()` triggers and the `processing_jobs` guard trigger. All of their FK targets already exist after 0008.
  - If 0001–0008 have **already run** on a shared environment (staging or production), don't edit them. Ship the column changes as `ALTER TABLE` statements at the top of 0009 instead.
- Seed: roles check data, a first SYSTEM_ADMIN (from env), rule set `NON_TEACHING_STD v1` (DRAFT until HR signs off), Philippine regular holidays for the current year (entered by HR, with proclamation references). No new seed for v3. Semi-monthly `dtr_periods` rows are created by HR in the app.
- Every migration is reviewed as SQL, tested against a restored copy of production data before release, and preceded by a backup.

## 14. Volume estimates (for indexing decisions)

| Table | Estimate |
|---|---|
| raw_attendance_records | ~1,000 employees × 4 punches × 22 days ≈ 90k rows/month (~1.1M/year) |
| processed_attendance | ~30k rows/month (one per employee-day; unchanged by semi-monthly periods) |
| dtr_periods | 24 rows/year (semi-monthly, ADR-21) |
| dtrs, dtr_documents | ~2,000 rows/month (1,000 employees × 2 periods), ~24k/year: **double** v2 |
| dtr_status_history | ~10k–15k rows/month (5–7 transitions per DTR) |
| dtr_items | ~30k rows/month (same number of days, split over two DTRs) |
| advance_credits | ~1,000 × 2–3 days × 24 periods ≈ 48k–72k rows/year (~4k–6k per month) |
| advance_credit_events | ~2 per credit (CREATED + one reconciliation), more for restorations: ≈ 100k–150k rows/year |
| offset_earning_requests, offset_ledger, makeup_class_details | hundreds to a few thousand rows per semester |
| audit_logs | ~100k–300k rows/month (reads included) |

All of this is comfortable for a single PostgreSQL instance. No partitioning is needed in Phase 1. Check PDF generation time with twice the DTR count (BE-022).
