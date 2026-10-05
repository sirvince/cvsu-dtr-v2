---
id: BE-007
title: Schedule templates + assign + per-employee blocks (pre-approved)
type: Feature
priority: P1
status: TODO
epic: E1 Foundation & setup data
module: schedules
week: 1
day: 2026-10-09
estimate_h: 5
depends_on: [BE-005, BE-008]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-007 — Schedule templates + assign + per-employee blocks (pre-approved)

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-database`

> [!info] v3 changes (2026-10-05)
> - **Per-employee schedule blocks** for faculty, who can have several entries per day (HR-02, D-HR-16, ADR-32). The default 8–5 template alone isn't enough, because the rules apply to **all employees** (Q-S4). Estimate **3 → 5 h**.
> - Phase 1 is HR-only, so **HR still creates schedules directly as `APPROVED`** (audited, `created_by` = HR), **outside** the two-level workflow. The Head → HR workflow (`SUBMITTED → ENDORSED → APPROVED`, ADR-28) is Phase 1B: [[BE-037-two-level-schedule-approval|BE-037]]. The status column already allows `ENDORSED` (DATABASE-MAPPING §5), so 1B adds no constraint swap.
> - Tardiness is measured from the **AM/PM group start**, not from each block (F01).
> - ⚠ Faculty schedules are typed in by HR (API + form). Ask HR for them as a spreadsheet (new prep item **P5**) so they can be loaded by script (BE-009). A schedule CSV import screen is 1B.

## 1. Background & problem
Tardiness is measured against an **approved** schedule. Phase 1 has no approval workflow, so HR creates schedules directly as `APPROVED`, either way:
- by assigning a template (default 08:00–12:00 / 13:00–17:00) to a department or to employees;
- by entering **per-employee blocks**. A faculty member may have, for example, Mon 07:00–10:00, 10:00–12:00, 14:00–16:00 and 16:00–19:00.

## 2. Objective
Templates, bulk assignment and per-employee block entry, all stored in the full v3 schedule tables as `APPROVED` and audited.

## 3. Scope
**In**
- [ ] Migration `0004_schedules`: `schedule_templates`, `employee_schedules` (🔒 partial EXCLUDE for APPROVED, `row_version` per BE-000 D6, status set incl. `ENDORSED` per DATABASE-MAPPING §5), `schedule_blocks`
- [ ] Requires migration `0003` (semesters) from BE-008 first; the endpoints pick the semester covering `effectiveFrom`
- [ ] `GET /schedule-templates`; seed **"Regular 8–5"** (Mon–Fri 08:00–12:00, 13:00–17:00)
- [ ] `POST /schedules/assign` `{ templateId, departmentId? | employeeIds[], effectiveFrom, effectiveTo }` → one `APPROVED` schedule + blocks per employee. If an approved one overlaps, **supersede** it in the same transaction: set its `effective_to = new.from − 1`, or mark it `SUPERSEDED`.
- [ ] **v3:** `POST /employees/:id/schedules` `{ effectiveFrom, effectiveTo, blocks: [{ dayOfWeek, startTime, endTime, label? }] }` ⚠ path per API-DESIGN §5.5 → one `APPROVED` schedule with any number of blocks per day, same supersede rule. `PUT` replaces the blocks of a schedule that no FINALIZED DTR uses yet.
- [ ] `GET /employees/:id/schedules`
- [ ] `ScheduleValidator` (domain): start < end, no overlap within a day, ISO day 1–7, inside the semester. Adjacent blocks (10:00–12:00 after 07:00–10:00) are allowed.
- [ ] `SchedulesService.approvedFor(employeeId, date)` → AM/PM groups (public service for BE-018/019/029):
  - group start = earliest block start in the group, group end = latest block end (BUSINESS-RULES §4.2)
  - `scheduledMinutes(date)` = Σ block minutes, used for advance credits (D-HR-04)
- [ ] Audit `SCHEDULE_ASSIGNED` / `SCHEDULE_CREATED` with `approval = DIRECT_HR` in `metadata`

**Out**
- Employee submission and two-level approval (1B, BE-037); schedule CSV import screen (1B)

## 4. Acceptance criteria
- [ ] Assigning a department creates one approved schedule per active employee
- [ ] Re-assigning from a later date supersedes the old schedule; there are never two approved schedules on one date
- [ ] The faculty schedule from analysis §8.6 (4 Monday blocks) saves. `approvedFor` returns AM group 07:00–12:00 and PM group 14:00–19:00, boundary 13:00, scheduled **600** min.
- [ ] Overlapping blocks (07:00–10:00 and 09:00–11:00) → `422 SCHEDULE_BLOCK_OVERLAP` ⚠ code per API-DESIGN §9
- [ ] HR-created schedules are `APPROVED` immediately with an audit row. No endorse/approve step is needed in Phase 1.
- [ ] `approvedFor` returns `null` for dates without a schedule (→ `NO_SCHEDULE` later)
- [ ] Changing schedules for dates in a FINALIZED DTR is rejected `SCHEDULE_LOCKED` (wire the check in BE-024)

## 5. Tests
- Unit: `ScheduleValidator`, AM/PM grouping with multiple blocks + boundary, `scheduledMinutes`.
- Int: EXCLUDE constraint, supersede logic, per-employee create.

## 6. References
[[CVSU-DTR/v3/BUSINESS-RULES]] §4.2, §6 · [[CVSU-DTR/v3/DATABASE-MAPPING]] §5 · [[CVSU-DTR/v3/README]] ADR-08, ADR-28, ADR-32 · [[CVSU-DTR/HR-Requirements-Analysis]] HR-02, D-HR-16, §8.5, §8.6 F01–F02
