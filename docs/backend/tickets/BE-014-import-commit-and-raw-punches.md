---
id: BE-014
title: Commit/discard + append-only raw punches
type: Feature
priority: P0
status: TODO
epic: E2 Attendance import
module: attendance / attendance-import
week: 2
day: 2026-10-15
estimate_h: 4
depends_on: [BE-012]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket, never-cut]
---

# BE-014 — Commit/discard + append-only raw punches

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-database`, `dtr-backend`

> [!important] Never cut
> Duplicate protection and append-only raw punches are on the "never cut" list.

> [!info] v3 changes (2026-10-05)
> After a successful commit, publish an in-process domain event `AttendanceImportCommitted { batchId, deviceId, detectedDateFrom, detectedDateTo }`. It has no subscriber in Phase 1. Automatic reconciliation (BE-031, Phase 1B) subscribes to it (ADR-24), so 1B doesn't have to touch the commit transaction. Estimate unchanged.

## 1. Background & problem
HR exports overlap (e.g., "last 30 days" every week). Punches must be saved **exactly once** and never edited afterwards — they are evidence (ADR-03, ADR-06). Acceptance **A5**.

## 2. Objective
Commit staged rows into `raw_attendance_records` with record-level dedup, enforced by the database.

## 3. Scope
**In**
- [ ] Migration (`0005_import_and_raw`): `raw_attendance_records` with 🔒 `UNIQUE (device_id, biometric_identifier, punched_at)`, indexes, `REVOKE UPDATE, DELETE, TRUNCATE … FROM app_user`, `forbid_mutation()` trigger; `v_unmatched_identifiers`
- [ ] `AttendanceService.ingest(batchId)` (attendance module owns the table): `INSERT … SELECT … FROM staging ON CONFLICT DO NOTHING` in ~5,000-row chunks, **one transaction per batch**
- [ ] `POST /attendance-imports/:id/commit`: `VALIDATED → COMMITTED`; returns `{ newPunches, duplicatePunches }`; committing an already `COMMITTED` batch returns the stored result (idempotent, BE-000 D8)
- [ ] `POST /attendance-imports/:id/discard` → `DISCARDED`
- [ ] Lock the batch row (`FOR UPDATE`) so two commits can't run at once
- [ ] Audit `ATTENDANCE_IMPORT_COMMITTED` / `_DISCARDED`
- [ ] *v3:* publish `AttendanceImportCommitted` **after** the transaction commits (never inside it). A subscriber failure must not undo the commit.
- [ ] Maintenance: purge staging rows 7 days after commit/discard (simple cron or manual script in Phase 1)

**Out**
- Retention purge of raw punches (privileged job, later)

## 4. Acceptance criteria
- [ ] Commit is all-or-nothing per batch
- [ ] Same file again → `0 new, N already imported` (**A5**)
- [ ] Overlapping file → only new punches inserted
- [ ] `UPDATE`/`DELETE` on raw punches as `app_user` → denied; as owner → trigger error
- [ ] `attendance-import` code never writes `raw_attendance_records` directly

## 5. Tests
Int (Testcontainers): dedup, overlap, append-only (grant + trigger), concurrent commit. API: commit/discard transitions, invalid transition → `422 IMPORT_INVALID_TRANSITION`.

## 6. References
[[CVSU-DTR/v3/DATABASE-MAPPING]] §6 · [[CVSU-DTR/v3/MODULES]] §4 attendance · [[CVSU-DTR/v3/REQUIREMENTS]] US-01 AC3, AC5
