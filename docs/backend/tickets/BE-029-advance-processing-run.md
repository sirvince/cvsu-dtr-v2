---
id: BE-029
title: Advance processing run + advance-credit generation
type: Feature
priority: P0
status: TODO
epic: E5 Advance processing
module: attendance (processing) / advance-credits
week: 3
day: 2026-10-23
estimate_h: 8
depends_on: [BE-019, BE-021]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket, never-cut, v3]
---

# BE-029 — Advance processing run + advance-credit generation

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-database`, `dtr-testing`

> [!important] New in v3 · never cut
> HR processes **every** semi-monthly period 2–3 days before its end (ADR-22). Without this, Phase 1 can't produce the DTR on HR's payroll timeline.
> The **ledger writes** (`advance_credits` + `CREATED` events) are never cut, even if the HR list screen is. Reconciliation (BE-031, Phase 1B) can be added later only if every credit was recorded correctly from the first run.
> Spans **Fri Oct 23 (4 h) + Mon Oct 26 (4 h)**.

## 1. Background & problem
HR answers Q-P2, Q-A1, Q-A2 and C-03 (D-HR-02 to D-HR-05): HR picks a `processed_until` date before the period end. Every employee with an approved schedule gets **full scheduled minutes** for each working date after it, and those days print with the schedule's times.
The credit is a decision made **before** the data exists, so it can't be rebuilt from inputs. It must be a persisted ledger, not derived data (ADR-23, which amends ADR-04).
Rules: [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] §12. Don't restate them here; implement what §12 says.

## 2. Objective
Extend `POST /dtr-periods/:id/generate-dtrs` so it accepts an optional `processedUntil`:
- Dates `≤ processedUntil` are processed normally (`attendance_basis` = `ACTUAL` / `SCHEDULE_DERIVED` / `MIXED`).
- Each scheduled working date `> processedUntil` gets an `ADVANCE` processed day and an `advance_credits` row with status `ADVANCED`.

The run is recorded as `processing_jobs.processing_type = 'ADVANCE'`.

## 3. Scope
**In**
- [ ] Migration `0008_advance_credits` ⚠ (number per [[CVSU-DTR/v3/DATABASE-MAPPING|DATABASE-MAPPING]] §13): `advance_credits` (🔒 `uq_advance_credit_open`, `idx_advance_credit_pending`) and `advance_credit_events` (🔒 `REVOKE UPDATE, DELETE, TRUNCATE … FROM app_user`), with columns exactly as DATABASE-MAPPING §8 defines them
- [ ] Request: `{ departmentId?, processedUntil? }` ⚠ final shape per [[CVSU-DTR/v3/API-DESIGN|API-DESIGN]] §5.7 (BE-000 D14). `processedUntil` set → `ADVANCE`; absent → `FULL`. The UI defaults the date to `dtr_periods.planned_advance_date`.
- [ ] Guard `period.start ≤ processedUntil < period.end`, else `422` ⚠ (error code per API-DESIGN §9)
- [ ] `AdvanceDayBuilder` (pure domain), for each date after `processedUntil`. The precedence rules come from BUSINESS-RULES §12:
  - scheduled minutes > 0 → slots from the AM/PM group start/end, `slot_sources = ADVANCE`, `status = ADVANCE_CREDIT`, `attendance_basis = ADVANCE`, tardy/undertime 0
  - rest day or holiday (0 scheduled minutes) → normal status, **no credit row** (D-HR-03)
  - no approved schedule → `NO_SCHEDULE` (blocking), no credit
  - a whole-day approved exception, or a whole-day suspension or government announcement on the date → handled as §12 says ⚠ (proposed: the exception/calendar wins and no credit is created)
- [ ] `credited_minutes` = Σ scheduled block minutes for the date (D-HR-04). Store `processing_job_id` and `employee_schedule_id` with it.
- [ ] Event `CREATED` (`trigger = ADVANCE_RUN`, `processing_job_id`) in the **same transaction** as the credit
- [ ] **Re-run on a DRAFT DTR** (BE-000 D13 ⚠, owned by BUSINESS-RULES §12):
  - existing `ADVANCED` credits of that DTR whose date is now `≤ processedUntil`, or any of them on a `FULL` run → `CANCELLED` + event `CANCELLED`
  - dates still after `processedUntil` keep their credit, with no duplicate row
  - a second advance run (until Sept 13, then until Sept 14) must not create two credits for Sept 14 (analysis §3.2)
- [ ] Credits on **FINALIZED** DTRs are never changed by generate. They wait for reconciliation (BE-031, 1B).
- [ ] Reprocessing never deletes `advance_credits` rows (ADR-23)
- [ ] Response summary gains `{ processingType, processedUntil, creditsCreated, creditsCancelled, creditedMinutes }`
- [ ] Audit `ADVANCE_PROCESSING_RUN` (period, `processedUntil`, actor) and `ADVANCE_CREDIT_CREATED` (one summary row per run, ids in `metadata`)

**Out**
- Rendering advance days on the DTR / Form 48, and the HR credit list (BE-030)
- Reconciliation, carry-forward (BE-031, BE-032, Phase 1B)

## 4. Acceptance criteria
- [ ] **A01** ([[CVSU-DTR/HR-Requirements-Analysis#8.6 New reference test cases (add to BUSINESS-RULES §10)|analysis §8.6]] / BUSINESS-RULES §10): faculty schedule, period Sept 1–15, `processedUntil = Sept 13`.
  - The credited Monday gets `ADVANCE_CREDIT`, credited **600** min, slots 07:00 / 12:00 / 14:00 / 19:00, `slot_sources = ADVANCE`.
  - Event `CREATED` is logged.
  - ⚠ Use **Mon Sept 14, 2026** in fixtures. Sept 15, 2026 is a Tuesday, and the analysis's faculty schedule is Monday-only.
- [ ] **A05**: without any import covering the credited date, the credit stays `ADVANCED`
- [ ] A Saturday or a regular holiday after `processedUntil` → no credit row
- [ ] An employee with no approved schedule → `NO_SCHEDULE`, no credit
- [ ] Re-running with a later `processedUntil` → the credit for the newly covered date is `CANCELLED` (event logged). The remaining credits are unchanged and there are no duplicates.
- [ ] `processedUntil = period.end` or a date outside the period → `422`
- [ ] Generate on a FINALIZED DTR leaves its credits and items untouched (**A10** still holds)
- [ ] `UPDATE advance_credit_events` as `app_user` → permission denied

## 5. Tests
- Unit: `AdvanceDayBuilder` (A01, rest day, holiday, no schedule, partial-day exception ⚠ §12).
- Int (Testcontainers): ledger + events in one transaction, re-run cancel/recreate, unique-open index, append-only grant.
- API: guard, summary shape.

## 6. References
[[CVSU-DTR/v3/BUSINESS-RULES]] §12 · [[CVSU-DTR/v3/DATABASE-MAPPING]] §8 · [[CVSU-DTR/v3/API-DESIGN]] §5.7 · [[CVSU-DTR/v3/README]] ADR-22, ADR-23, ADR-26 · [[CVSU-DTR/HR-Requirements-Analysis]] D-HR-02 to D-HR-05, §8.6 A01, A05
