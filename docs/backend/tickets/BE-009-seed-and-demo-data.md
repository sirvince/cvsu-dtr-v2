---
id: BE-009
title: Seed script + employee loader + week-1 demo
type: Task
priority: P1
status: TODO
epic: E1 Foundation & setup data
module: database
week: 1
day: 2026-10-09
estimate_h: 2
depends_on: [BE-005, BE-007, BE-008]
blocked_by: [P3 employee list]
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-009 — Seed script + employee loader + week-1 demo

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skill: `dtr-database`

> [!info] v3 changes (2026-10-05)
> - The seed creates **semi-monthly** periods (ADR-21) instead of "October 2026".
> - It adds a faculty demo schedule and GOVERNMENT_ANNOUNCEMENT examples.
> - It includes the **one-off employee loader** that replaces BE-006 in Phase 1 (BE-006 moved to 1B).
> - It includes an optional faculty-schedule loader if HR provides P5.
> - Estimate **1 → 2 h**. P3 is now a blocker here.

## 1. Objective
One command that prepares a usable database, and the **Fri Oct 9 demo**:
- the real employee list is loaded;
- default and faculty schedules are assigned;
- the **Oct 2026 (1–15)** and **(16–31)** periods exist.

## 2. Scope
**In**
- [ ] `yarn workspace @cvsu-dtr/api seed` (idempotent) creates:
  - the first admin (invite/CLI password) and device `MAIN-01`
  - template "Regular 8–5"; AY 2026-2027 + 1st semester
  - **periods Oct 1–15, Oct 16–31, Nov 1–15, Nov 16–30, 2026** with `planned_advance_date` left **empty** (HR sets it) ⚠
  - PH regular holidays for Oct–Dec 2026 (HR confirms the list); departments
- [ ] **v3:** `seed:employees <csv>`: a one-off loader for the P3 list, using BE-006's column set and row rules. It prints a row-error report, upserts by `employee_number` and creates the biometric mapping on `MAIN-01`. Run by the developer, not HR.
- [ ] **v3:** `seed:schedules <csv>` (optional, if HR delivers P5 faculty schedules as a spreadsheet): creates per-employee `APPROVED` schedules through `SchedulesService` (same validator as BE-007)
- [ ] `seed:demo`: synthetic departments + 50 employees with biometric IDs, **including 5 faculty with the 4-block Monday schedule** from analysis §8.6 (for local/staging; **no real personal data**)
- [ ] README section "Week 1 demo script"

## 3. Acceptance criteria
- [ ] Running `seed` (and `seed:employees` with the same file) twice causes no duplicates or errors
- [ ] Demo: log in → see employees with biometric IDs and schedules (including one faculty schedule) → both October periods exist → holidays listed

## 4. References
[[CVSU-DTR/v3/DATABASE-MAPPING]] §13 · [[CVSU-DTR/v3/PHASE1-MVP-1-MONTH]] §8 week 1 · [[CVSU-DTR/v3/README]] ADR-21
