---
name: dtr-database
description: Design, migrate, or query the CVSU DTR PostgreSQL database (TypeORM migrations, entities, constraints, triggers, grants, views). Use when creating or reviewing a migration, adding a table or column, writing a TypeORM entity or repository, writing raw SQL, handling dates/times/timezones in storage, deduplicating punches, touching append-only/immutable tables (raw_attendance_records, audit_logs, dtr_items, published rule sets, advance_credit_events, offset_ledger), or working on semi-monthly periods, advance processing, reconciliation, carry-forward adjustments, offset balances or make-up classes.
---

# CVSU DTR — Database

PostgreSQL 17 (16+ OK) is the **only system of record** (ADR-02). TypeORM is used with **migrations only** — `synchronize: false` everywhere except throwaway local DBs.

The normative DDL is in `DATABASE-MAPPING.md` (repo `docs/` or vault `CVSU-DTR/v3/`). Constraints marked 🔒 there are integrity guarantees — **never drop or weaken them**, even "temporarily".

## Conventions

| Item | Rule |
|---|---|
| Names | `snake_case`, plural tables, FK = `<entity>_id`; period FK is always `dtr_period_id` |
| PK | `id uuid DEFAULT gen_random_uuid()`; `audit_logs` uses `bigint GENERATED ALWAYS AS IDENTITY` |
| Business IDs | Separate unique columns (`employee_number`, `code`) |
| Enums | `text` + `CHECK (... IN (...))` — **not** PG enums. Mirror the values in `packages/shared` |
| Audit columns | `created_at`, `updated_at` (`timestamptz`), plus `created_by` / `updated_by` where a human acts |
| Deletion | Master data is deactivated (`status`), never deleted. History is append-only or `ON DELETE RESTRICT` |
| Extensions | `pgcrypto` (or built-in `gen_random_uuid`), `citext`, `btree_gist` |

## Time and timezone (ADR-16)

| Value | Type | Rule |
|---|---|---|
| Instants (punches, `*_at`) | `timestamptz` | Stored UTC. DB session `TimeZone = 'UTC'` |
| Device export times (no zone) | → `timestamptz` | Parser interprets them as `Asia/Manila` |
| Business date of a punch | `date` (`punch_date`) | Computed **by the app** as the Manila local date |
| Schedule / DTR slot times | `time` | Local wall-clock; no midnight crossing in Phase 1 |
| Calendar dates | `date` | — |

Driver pitfalls:
- `pg` parses `date` (OID 1082) into a JS `Date` at local midnight → off-by-one days. Register a parser that keeps it a string: `types.setTypeParser(1082, (v) => v)`. TypeORM entity `date` columns should be typed `string` (`'YYYY-MM-DD'`).
- Map `time` columns to `string` (`'HH:mm:ss'`) and convert to `LocalTime` in the repository, not in the domain.
- Never compute `punch_date` with `::date` in SQL on a `timestamptz` (it uses the session zone, UTC). If SQL must do it: `(punched_at AT TIME ZONE 'Asia/Manila')::date`.

## DB roles and grants

| Role | Used by | Rights |
|---|---|---|
| `migrator` | `migration:run` (CI/deploy), `DATABASE_MIGRATOR_URL` | DDL owner |
| `app_user` | API + worker, `DATABASE_URL` | DML, **minus** UPDATE/DELETE/TRUNCATE on append-only tables |
| privileged purge role | Retention job only | May disable the immutability trigger inside a controlled, logged job |

Every migration that creates a table must also `GRANT` to `app_user` what it needs — and nothing more.

## Integrity guarantees (🔒) — keep these in every migration

| Guarantee | Mechanism |
|---|---|
| Raw punches are append-only (ADR-03) | `REVOKE UPDATE, DELETE, TRUNCATE … FROM app_user` **and** `BEFORE UPDATE OR DELETE` trigger `forbid_mutation()` |
| Record-level punch dedup (ADR-06) | `UNIQUE (device_id, biometric_identifier, punched_at)` on `raw_attendance_records` |
| Raw punches have no `employee_id` | Matching happens at processing time via `employee_biometric_ids` |
| One biometric ID → one employee per date | `EXCLUDE USING gist (device_id WITH =, biometric_identifier WITH =, daterange(valid_from, valid_to, '[]') WITH &&)` |
| DTR periods never overlap | `EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&)` |
| Periods are semi-monthly (ADR-21) | `period_half IN (1,2)` + CHECK: half 1 = day 1 → day 15; half 2 = day 16 → last day of the same month |
| ≤ 1 APPROVED schedule per employee per date | Partial `EXCLUDE … WHERE (status = 'APPROVED')` |
| Maker-checker on exceptions (ADR-11, ADR-28) | `CHECK (reviewed_by IS NULL OR reviewed_by <> requested_by)` **and** `CHECK (endorsed_by IS NULL OR endorsed_by <> requested_by)`; endorser ≠ approver |
| Maker-checker on schedules (ADR-28) | `endorsed_by` / `reviewed_by` ≠ `created_by`; endorser ≠ approver |
| Make-up class needs a letter (ADR-31) | `CHECK (type <> 'MAKE_UP_CLASS' OR attachment_file_id IS NOT NULL)` |
| Advance runs stay inside the period (ADR-22) | `(processing_type = 'ADVANCE') = (processed_until IS NOT NULL)` + trigger `processing_jobs_guard()`: `start_date ≤ processed_until < end_date` |
| ≤ 1 live advance credit per employee-date | `UNIQUE (employee_id, credit_date) WHERE status <> 'CANCELLED'` (`uq_advance_credit_open`) |
| Adjustments never land in the credit's own period (ADR-25) | `CHECK (applied_in_dtr_period_id IS NULL OR applied_in_dtr_period_id <> dtr_period_id)` |
| Advance credits are never deleted (ADR-23) | `REVOKE DELETE, TRUNCATE ON advance_credits FROM app_user` |
| Advance-credit history and offset ledger are append-only (ADR-23, ADR-29) | `REVOKE UPDATE, DELETE, TRUNCATE` **and** `forbid_mutation()` trigger on `advance_credit_events` and `offset_ledger` |
| One DTR per employee per period | `UNIQUE (employee_id, dtr_period_id)` |
| One processed row per employee-day | `UNIQUE (employee_id, work_date)` |
| Finalized DTR items are frozen (ADR-13) | Trigger on `dtr_items` rejecting writes when parent `dtrs.status IN ('FINALIZED','SUBMITTED','RECEIVED')` |
| Published rule sets are immutable (ADR-09) | Trigger blocking UPDATE of `config` / `effective_from` when `status = 'PUBLISHED'` |
| Audit log is append-only | `REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_user` |

Plain CHECKs that also matter (not 🔒, but don't drop them): `GOVERNMENT_ANNOUNCEMENT ⇒ scope = 'ALL'`, `WELLNESS / ASYNCHRONOUS ⇒ scope = 'WHOLE_DAY'`, `status = 'ADVANCE_CREDIT' ⇔ attendance_basis = 'ADVANCE'`, and the advance-credit state/adjustment CHECKs (RECONCILED ⇒ net 0, ADJUSTED ⇒ net < 0, REVERSED ⇒ net = −credited).

**Rules the DB does *not* enforce** (they need aggregates, so they live in the domain): the wellness limit of 4 whole days per academic year (`WELLNESS_LIMIT_REACHED`), the offset balance (`OFFSET_BALANCE_INSUFFICIENT`), and which exception types need endorsement.

The doc describes three triggers only in comments. Use these bodies:

```sql
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'P0001'; END $$;

CREATE FUNCTION dtr_items_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM dtrs WHERE id = COALESCE(NEW.dtr_id, OLD.dtr_id);
  IF s IN ('FINALIZED','SUBMITTED','RECEIVED') THEN
    RAISE EXCEPTION 'dtr_items are frozen for DTR in status %', s USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_dtr_items_frozen BEFORE INSERT OR UPDATE OR DELETE ON dtr_items
  FOR EACH ROW EXECUTE FUNCTION dtr_items_frozen();

CREATE FUNCTION rule_set_published_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' AND (NEW.config IS DISTINCT FROM OLD.config
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from) THEN
    RAISE EXCEPTION 'published rule set % v% is immutable', OLD.code, OLD.version USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_rule_set_immutable BEFORE UPDATE ON attendance_rule_sets
  FOR EACH ROW EXECUTE FUNCTION rule_set_published_immutable();

-- v3: advance runs must stop before the period end (ADR-22)
CREATE FUNCTION processing_jobs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p dtr_periods%ROWTYPE;
BEGIN
  IF NEW.processed_until IS NOT NULL THEN
    SELECT * INTO p FROM dtr_periods WHERE id = NEW.dtr_period_id;
    IF NOT (p.start_date <= NEW.processed_until AND NEW.processed_until < p.end_date) THEN
      RAISE EXCEPTION 'processed_until % outside [%, %)', NEW.processed_until, p.start_date, p.end_date
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_processing_jobs_guard BEFORE INSERT OR UPDATE OF processed_until, dtr_period_id
  ON processing_jobs FOR EACH ROW EXECUTE FUNCTION processing_jobs_guard();

-- v3: reuse forbid_mutation() for the new append-only ledgers
CREATE TRIGGER trg_adv_credit_events_immutable BEFORE UPDATE OR DELETE ON advance_credit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_offset_ledger_immutable BEFORE UPDATE OR DELETE ON offset_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
```

These bodies and the v3 DDL in `DATABASE-MAPPING.md` were run against PostgreSQL 17 (with tables created in migration order, see below).

> Finalize order matters: the snapshot of `dtr_items` must be written **before** the status flips to `FINALIZED` in the same transaction, otherwise the freeze trigger blocks it. Reopen flips the status back to `DRAFT` first, then items may be rebuilt.

## Key write patterns

**Commit an import (dedup):**
```sql
INSERT INTO raw_attendance_records
  (import_batch_id, device_id, biometric_identifier, punched_at, punch_date, raw_state, raw_payload)
SELECT s.import_batch_id, $2, s.biometric_identifier, s.punched_at, s.punch_date, s.raw_state, s.raw_payload
FROM attendance_import_staging s
WHERE s.import_batch_id = $1 AND s.row_number > $3 AND s.row_number <= $4
ON CONFLICT (device_id, biometric_identifier, punched_at) DO NOTHING;
```
Run in ~5,000-row chunks inside one transaction per batch. Sum `rowCount` → `new_punches`; `valid_rows − new_punches` → `duplicate_punches`.

**Finalize a DTR** (`DATABASE-MAPPING.md §9`): `SELECT … FOR UPDATE` on `dtrs` → check status `VALIDATED` (Phase 1: `DRAFT`) and maker-checker → copy processed rows into `dtr_items` → set `FINALIZED` → insert `dtr_status_history` + `audit_logs` → commit. The worker then renders the PDF and inserts `dtr_documents` (`status='CURRENT'`).

**Supersede a schedule:** in one transaction, set the previous approved schedule's `effective_to = new.effective_from − 1` (or `SUPERSEDED` if that empties it), then approve the new one. The partial EXCLUDE constraint will catch mistakes.

**Processing:** `pg_advisory_xact_lock(hashtext('process:' || dtr_period_id))` so two runs on the same period can't overlap. Upsert `processed_attendance` with `ON CONFLICT (employee_id, work_date) DO UPDATE` (ids stay stable, because ledgers point at them), skipping dates locked by FINALIZED+ DTRs. Set `attendance_basis`, `slot_sources` (`PUNCH` / `CORRECTION` / `SCHEDULE` / `ADVANCE`) and `exception_ids` on every row.

**Ledgers are not derived data (ADR-23).** `advance_credits`, `advance_credit_events`, `offset_ledger` and the outcome columns of `makeup_class_details` are **never** deleted, truncated or rebuilt by reprocessing, and are not part of `input_fingerprint`. A "rebuild the period" job must leave them alone.

**Advance run (ADR-22)** (`processing_type = 'ADVANCE'`, `processed_until` set): dates ≤ `processed_until` are processed normally. For each later date with scheduled minutes > 0, upsert a processed row with `status = 'ADVANCE_CREDIT'`, `attendance_basis = 'ADVANCE'` and slots from the schedule. Then `INSERT … ON CONFLICT DO NOTHING` the `advance_credits` row (the partial unique index blocks duplicates) plus a `CREATED` event (`trigger = 'ADVANCE_RUN'`). A second advance run with a later `processed_until` reconciles the earlier credits; it never duplicates them.

**Reconciliation (ADR-24, ADR-25)**, in the import-commit transaction or right after it: queue a `RECONCILIATION` job with `import_batch_id`. For every credit `WHERE status = 'ADVANCED' AND credit_date <= batch.detected_date_to` (index `idx_advance_credit_reconcile`):
1. Recompute the actual day. This is allowed even if the credit's DTR is FINALIZED; `dtr_items` stay frozen.
2. Update the credit (status, net `adjustment_minutes`, `reconciliation_trigger`, `reconciled_at`) **and** insert an `advance_credit_events` row with the signed delta, in the same transaction.
3. Carry the delta into the next open period: the first later period whose DTR for that employee is not FINALIZED+. Lock that `dtrs` row `FOR UPDATE` while writing, so a concurrent finalize can't miss it.

Late exception approvals use `trigger = 'EXCEPTION_APPROVED'` and write `RESTORED` (+) events. Rules: BUSINESS-RULES §12.

**Offset balance (ADR-29):** inside `pg_advisory_xact_lock(hashtext('offset:' || employee_id || ':' || semester_id))`, read `SUM(minutes)` from `offset_ledger`, reject if it's below the requested minutes, then insert the `USED` row in the same transaction. Approving an earning request inserts `EARNED` (unique per request). The semester-end job inserts one `EXPIRED` row per (employee, semester) with a non-zero balance. Revocation = a `REVERSED` row, never an UPDATE.

**DTR totals (v3):** `advance_credit_minutes` = Σ live credits of the period. `prior_period_adjustment_minutes` = Σ `advance_credit_events.adjustment_minutes` + Σ `makeup_class_details.reversal_minutes` whose `applied_in_dtr_period_id` is this period. Compute them in the finalize transaction.

**Stale marking:** approving/revoking an exception or changing a calendar event sets `processed_attendance.is_stale = true` for affected `(employee_id, work_date)` rows in the same transaction. If an affected date has an advance credit or a finalized DTR, the approval also triggers re-reconciliation (carry-forward), not just stale marking.

## Optimistic locking — watch the `version` columns

`dtrs.version` is the **DTR document version** (+1 on reopen, printed on the PDF) and `employee_schedules.version` is the **schedule version**. Do **not** put TypeORM `@VersionColumn` on those — it would bump them on every save. Add a separate `row_version int NOT NULL DEFAULT 1` column with `@VersionColumn()` and expose *that* as the `If-Match` value.

## TypeORM

- `synchronize: false`, `migrationsRun: false` in the app; migrations run as `migrator` in CI/deploy.
- Entities live in `modules/<m>/infrastructure/entities/`; the domain never sees them — repositories map entity ↔ domain object.
- One repository per aggregate with meaningful methods (`lockById`, `findApprovedFor(employeeId, date)`), not a generic `BaseRepository<T>`.
- Use parameters (`$1`, `:name`) — never concatenate user input. Sort columns come from a whitelist map.
- Bulk inserts: multi-row `INSERT` or `COPY`; don't `save()` thousands of entities one by one.
- Review the **generated SQL** of every migration; TypeORM sometimes drops/recreates columns or misses `EXCLUDE`, partial indexes, triggers and grants — write those by hand with `queryRunner.query()`.
- Every migration has a working `down()` (or an explicit comment explaining why it's irreversible).

## Migration naming and order

```
0001_init_users_auth   0002_org_and_devices   0003_academic_calendar   0004_schedules
0005_import_and_raw    0006_rules_exceptions_processing   0007_dtr   0008_audit_and_views
0009_advance_and_reasons
```
v3 placement (`DATABASE-MAPPING.md §13`): new columns/CHECKs go into the migration that creates the table (periods and calendar → 0003, schedules → 0004, exceptions, jobs and processed → 0006, dtrs and items → 0007). The new tables go into `0009_advance_and_reasons`, in this order: `makeup_class_details`, `offset_earning_requests`, `offset_ledger`, `advance_credits`, `advance_credit_events`, plus indexes, REVOKEs and triggers. `user_department_scopes` (doc §4) references `departments`, so it belongs in 0002, not 0001. If 0001–0008 already ran on a shared environment, ship the column changes as `ALTER`s in 0009 instead.

Later migrations: next number + short snake_case purpose (`0010_dtrs_row_version`). Never edit a migration that has run on staging/production — add a new one.

Release procedure: backup → review SQL → test against a restored copy of prod → `migration:run` as `migrator` → `/health/ready`.

## Seed data

Roles check data; first `SYSTEM_ADMIN` from env (no default password — invite flow); device `MAIN-01` (Phase 1); rule set `DEFAULT v1` / `NON_TEACHING_STD v1` (DRAFT until HR signs off); default schedule template 08:00–12:00 / 13:00–17:00; Philippine regular holidays entered by HR with proclamation references. Local/staging use **synthetic or anonymized** data only.

## Views

`v_unmatched_identifiers`, `v_dtr_submission_status`, `v_period_tardiness`, `v_import_log`, `v_employees_without_schedule`. Reports are read-only and may only query views/read models.

## Known gaps in the docs (decide, then record in the ADR log)

- ~~`dtrs` has no `half_days_absent`~~: added in v3.
- Carry-forward restorations for days that had **no** advance credit (a late-approved leave, or a make-up letter approved after finalization, D-HR-22 / M06) have no ledger row yet, so `prior_period_adjustment_minutes` doesn't include them. This needs a decision and an ADR (likely a generic carry-forward ledger).
- Reopening a finalized DTR whose credits were already reconciled and carried forward: rebuilding its items from actual data would double-count the carried delta. The rule for this is open in BUSINESS-RULES §12.
- `dtrs` / `employee_schedules` need a `row_version` for `If-Match` (see above).
- An `idempotency_keys` table is referenced (`DESIGN-PATTERNS.md §7`) but not defined. Suggested: `(key text, user_id uuid, route text, request_hash char(64), response jsonb, created_at timestamptz, PRIMARY KEY (user_id, route, key))`, purged after 24 h.
- Totals on `dtrs` are `numeric(4,1)` for days; keep minute totals as `int`.

## Checklist for any schema change

- [ ] Matches `DATABASE-MAPPING.md` (or the doc is updated in the same PR, with an ADR line if it's a decision)
- [ ] No 🔒 constraint, trigger or REVOKE removed or weakened
- [ ] `text + CHECK` enum values mirrored in `packages/shared`
- [ ] Grants for `app_user` added; append-only tables still have no UPDATE/DELETE
- [ ] Ledgers (`advance_credits`, `advance_credit_events`, `offset_ledger`, make-up outcomes) are not touched by any rebuild/cleanup path; FKs from ledgers to `processed_attendance` are `ON DELETE SET NULL`
- [ ] Indexes for the new query paths (FK columns, `(dtr_period_id, …)` filters)
- [ ] `date`/`time`/`timestamptz` chosen per the time table above
- [ ] Hand-written SQL for EXCLUDE / partial indexes / triggers / views
- [ ] Testcontainers test proving the constraint fires (see `dtr-testing`)
- [ ] `down()` works on a fresh DB
