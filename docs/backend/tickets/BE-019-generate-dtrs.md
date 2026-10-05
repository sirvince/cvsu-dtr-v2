---
id: BE-019
title: Generate DTRs (processed_attendance, dtrs, dtr_items)
type: Feature
priority: P0
status: TODO
epic: E3 DTR generation
module: attendance (processing) / dtr
week: 3
day: 2026-10-21
estimate_h: 5
depends_on: [BE-000, BE-014, BE-018]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-019 — Generate DTRs

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-database`

## 1. Background & problem
Processing runs **per DTR period**, never per import file (ADR-05). Generating must be safe to repeat and must never touch finalized DTRs (acceptance **A7, A10**).

## 2. Objective
`POST /dtr-periods/:id/generate-dtrs { departmentId? }` (synchronous in Phase 1): process attendance for the month, then create/refresh one DRAFT DTR per employee.

## 3. Scope
**In**
- [ ] Migration `0007_dtr`: `dtrs` (+ `row_version`, `half_days_absent` per BE-000), `dtr_items` (+ 🔒 frozen trigger), `dtr_status_history`, `dtr_documents`
- [ ] `ProcessPeriodUseCase`: advisory lock per `dtr_period_id` → active employees in scope → biometric IDs valid in period → raw punches `[start−1, end+1]` grouped by Manila date → for each date: schedule (`approvedFor`), calendar, exceptions, rule set → `DayCalculator` → upsert `processed_attendance` (`ON CONFLICT (employee_id, work_date)`), **skip dates of FINALIZED DTRs**; store `rule_set_id`, `input_fingerprint`, used/ignored punch IDs; `processing_jobs` row with summary
- [ ] `GenerateDtrsUseCase`: per employee → create DTR (DRAFT) or rebuild items of an existing DRAFT; compute totals (§5.10); skip FINALIZED; history `generate`/`regenerate`
- [ ] Response summary: `{ employees, generated, regenerated, skippedFinalized, noSchedule[], blockingDays }`
- [ ] `PeriodsService.assertOpen()`; audit `DTRS_GENERATED`
- [ ] Batch work in chunks (e.g., 100 employees) with short transactions; DB queries batched (no N+1)

**Out**
- pg-boss job + progress polling (1B), `onlyStale` processing (1B)

## 4. Acceptance criteria
- [ ] One DTR per active employee for the department (**A7**); employees without schedule listed and their days flagged `NO_SCHEDULE`
- [ ] Running generate twice gives identical items (idempotent)
- [ ] A FINALIZED DTR is not changed by generate (**A10**)
- [ ] Each processed day stores its rule set and fingerprint
- [ ] Two concurrent generate calls for the same period don't interleave (advisory lock)

## 5. Tests
Int: full generate on seeded data; idempotency; finalized skip; lock. API: summary shape, `PERIOD_NOT_OPEN`.

## 6. References
[[CVSU-DTR/v3/BUSINESS-RULES]] §2–§3, §5.10 · [[CVSU-DTR/v3/DATABASE-MAPPING]] §8–§9 · [[CVSU-DTR/v3/REQUIREMENTS]] US-05, US-06
