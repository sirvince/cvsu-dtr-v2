---
id: BE-008
title: Semi-monthly DTR periods + holidays + government announcements (calendar)
type: Feature
priority: P1
status: TODO
epic: E1 Foundation & setup data
module: academic-periods / calendar
week: 1
day: 2026-10-08
estimate_h: 4
depends_on: [BE-003]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-008 — Semi-monthly DTR periods + holidays + government announcements (calendar)

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-database`

> [!info] v3 changes (2026-10-05)
> - DTR periods are **semi-monthly** (1–15, 16–end of month) for **all** employees (ADR-21, D-HR-01). This replaces "months" and supersedes BUSINESS-RULES Q13. It must be built this way **before** anything depends on it.
> - New columns `period_half` and optional `planned_advance_date` (HR's "cutoff", D-HR-02). The system never hard-codes "2–3 days before".
> - New calendar type **`GOVERNMENT_ANNOUNCEMENT`**: government-wide (`scope = ALL` only), can be partial-day, memo number in `reference` (ADR-27, D-HR-11).
> - Estimate **3 → 4 h**.

## 1. Background & problem
DTRs are generated **per semi-monthly period**, and each period prints as its own CSC Form 48 (ADR-21). Without holiday data every holiday shows up as an absence (acceptance **A9**). Government announcements excuse time for everyone, like a suspension.

## 2. Objective
Create semi-monthly periods (both halves of a month in one call) and maintain holidays, suspensions and government announcements.

## 3. Scope
**In**
- [ ] Migration `0003_academic_calendar`: `academic_years`, `semesters`, `dtr_periods` (🔒 no-overlap EXCLUDE, **`period_half` 1|2**, **`planned_advance_date`**, CHECKs per DATABASE-MAPPING §5), `calendar_events` (type set incl. `GOVERNMENT_ANNOUNCEMENT`, CHECK `scope = 'ALL'` for it), `calendar_event_departments`
- [ ] `POST /dtr-periods { year, month }` → creates **both** halves:
  - "Oct 2026 (1–15)" = Oct 1–15, `period_half = 1`
  - "Oct 2026 (16–31)" = Oct 16–end, `period_half = 2`
  - status `OPEN`, `semester_id` from the date
  - ⚠ path per API-DESIGN §5.4
- [ ] `PATCH /dtr-periods/:id { plannedAdvanceDate }`, with guard `start ≤ date < end`
- [ ] `GET /dtr-periods`, `POST /dtr-periods/:id/close`
- [ ] Minimal `GET/POST /academic-years`, `/semesters` (or seed AY 2026-2027 + 1st semester) so schedules have a semester
- [ ] `GET /calendar-events?from&to`, `POST`, `DELETE /calendar-events/:id`
  - types: REGULAR_HOLIDAY, SPECIAL_NON_WORKING, SPECIAL_WORKING, WORK_SUSPENSION, **GOVERNMENT_ANNOUNCEMENT**
  - optional `startTime` / `endTime` for partial days, plus `reference`
  - scope = ALL in Phase 1
- [ ] `CalendarService.eventsFor(date, departmentId)` (public service for BE-018/029)
- [ ] `PeriodsService.get(id)` with an `assertOpen()` helper → `422 PERIOD_NOT_OPEN`. Plus `PeriodsService.nextOpenAfter(periodId)` (used by BE-032).
- [ ] Audit create/close/delete

**Out**
- Period reopen workflow, department-scoped events (1B)

## 4. Acceptance criteria
- [ ] `POST { 2026, 10 }` → Oct 1–15 and Oct 16–31. `{ 2027, 2 }` → Feb 1–15 and Feb 16–28. Calling it again → `409 PERIOD_OVERLAP`.
- [ ] Overlapping periods → `409 PERIOD_OVERLAP`
- [ ] `plannedAdvanceDate` outside `[start, end)` → `422`
- [ ] Holidays for Oct–Dec 2026 can be entered with a proclamation reference
- [ ] A GOVERNMENT_ANNOUNCEMENT with department scope → rejected. A partial-day one from 15:00 is accepted (used by **R02**).
- [ ] Deleting a holiday or announcement is audited (and in 1B marks days stale)

## 5. Tests
- Int: period EXCLUDE, half generation incl. February and 31-day months, the announcement scope CHECK.
- API: create/list/delete, PERIOD_OVERLAP.

## 6. References
[[CVSU-DTR/v3/BUSINESS-RULES]] §5.6, §9 · [[CVSU-DTR/v3/DATABASE-MAPPING]] §5 · [[CVSU-DTR/v3/README]] ADR-21, ADR-22, ADR-27 · [[CVSU-DTR/HR-Requirements-Analysis]] D-HR-01, D-HR-02, D-HR-11
