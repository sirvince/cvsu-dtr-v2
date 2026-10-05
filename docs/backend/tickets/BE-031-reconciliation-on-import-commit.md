---
id: BE-031
title: Automatic reconciliation on import commit + history + reversal summary
type: Feature
priority: P0
status: TODO
epic: E6 Reconciliation & carry-forward
module: advance-credits / attendance-import
week: 5
day: 2026-11-02
estimate_h: 8
depends_on: [BE-014, BE-029]
blocked_by: []
phase: 1B
tags: [cvsu-dtr, backend, ticket, never-cut, v3, hard-date]
---

# BE-031 — Automatic reconciliation on import commit + history + reversal summary

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-database`, `dtr-testing`

> [!danger] First Phase 1B ticket · hard date **Wed Nov 11, 2026**
> This must be live before HR finalizes the **second** semi-monthly DTR after go-live. If the Oct 16–31 DTR is advance-processed in the system on Oct 28–30, the first deductions must land on the Nov 1–15 DTR, which is advance-processed around Thu Nov 12.
> Target: done **Wed Nov 4**, with BE-032 done Fri Nov 6, so a week of buffer remains.
> If HR does **not** advance-process Oct 16–31 in the system, the hard date relaxes to **Tue Nov 24** (before the Nov 16–30 run). Why this is 1B and not Phase 1: [[CVSU-DTR/v3/PHASE1-MVP-1-MONTH|PHASE1-MVP]] §0.

## 1. Background & problem
HR answers Q-A5, Q-A6 and C-04 (D-HR-07, D-HR-08, D-HR-19): reconciliation is **automatic** and keeps **full history**. Once an import covers a credited date, "no punches" means **ABSENT → REVERSED**.
A missing device export would then reverse everyone's credit for that date. HR needs to see this immediately, in the import result (analysis §8.2).
Rules: [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] §12 (outcome mapping, coverage, adjustment minutes). Don't restate them here.

## 2. Objective
When an import batch is committed, reconcile every `ADVANCED` credit whose date the batch covers. Each one becomes `RECONCILED`, `ADJUSTED` or `REVERSED`, with an append-only event, and the import result shows a reversal summary and data-gap warnings.

## 3. Scope
**In**
- [ ] Subscribe to `AttendanceImportCommitted` (published by BE-014). Run `ReconcileAdvanceCreditsUseCase` **after** the commit transaction. A reconciliation failure never rolls back the commit; it is logged and retried by the catch-up command.
- [ ] Coverage (ADR-24): `ADVANCED` credits with `detected_date_from ≤ credit_date ≤ detected_date_to` of the batch, **and** the batch's device must be one the employee is mapped to on that date (`employee_biometric_ids`). A batch from another device never reconciles the credit.
- [ ] **Re-evaluation** (ADR-24, BUSINESS-RULES §12.4): a later covering import that brings **punches** for an already `REVERSED` / `ADJUSTED` date re-evaluates the credit. If the result improves, the minutes are restored through BE-032 (`restore`, event `RESTORED`, trigger `IMPORT`). A re-evaluation never deducts twice.
- [ ] Only credits whose DTR is **FINALIZED** are reconciled. Credits on DRAFT DTRs are cancelled and recomputed on the next generate (BE-000 D13 ⚠).
- [ ] For each credit:
  - compute the **actual** day with `DayCalculator` (same inputs as a normal run, without the advance path);
  - map the result to `RECONCILED` / `ADJUSTED` / `REVERSED` and `adjustment_minutes` per BUSINESS-RULES §12;
  - set `actual_day_status`, `reconciled_at`, `reconciliation_trigger = IMPORT` (`reconciled_by` = null, system).
  - ⚠ Where the actual day result is stored (the locked `processed_attendance` row vs. the credit/event only) is decided in DATABASE-MAPPING §8. `UNIQUE(employee_id, work_date)` allows only one processed row per date.
- [ ] Event per change (`RECONCILED` / `ADJUSTED` / `REVERSED`, `trigger = IMPORT`, `import_batch_id`, `processing_job_id`) in the same transaction as the status change
- [ ] A `processing_jobs` row with `processing_type = 'RECONCILIATION'` and a summary
- [ ] **Reversal summary** in the commit response and on `GET /attendance-imports/:id`: `{ reconciled, adjusted, reversed, byDate: [{ date, reversed, adjusted }] }`
- [ ] **Suspected data gap** flag: a date where more than 50 % of credited employees are reversed ⚠ (threshold in the rule set, per §12). Shown as a warning on the import result; reconciliation still runs (HR answer Q-A6).
- [ ] **Catch-up command** for imports committed between go-live (Oct 30) and this deploy, and for retries: `POST /advance-credits/reconcile { dtrPeriodId? }` ⚠ path per API-DESIGN. HR_ADMIN only, `trigger = MANUAL`. It uses the committed batches that cover each date.
- [ ] Idempotent: running again creates no new events for credits that are already reconciled
- [ ] Audit `ADVANCE_CREDIT_RECONCILED` / `_ADJUSTED` / `_REVERSED` (one summary row per run)

**Out**
- Where the adjustment lands (next open DTR) and how it prints (BE-032)
- Restoring credit after a late approval (BE-032 for HR remarks, BE-033 for approvals)

## 4. Acceptance criteria
Test cases from [[CVSU-DTR/HR-Requirements-Analysis#8.6 New reference test cases (add to BUSINESS-RULES §10)|analysis §8.6]] / BUSINESS-RULES §10, on top of the A01 fixture (Mon Sept 14, 2026 ⚠):
- [ ] **A02**: import covering the date, punches 06:58, 12:01, 13:59, 19:02 → `RECONCILED`, adjustment 0
- [ ] **A03**: 07:30, 12:00, 14:00, 19:00 → `ADJUSTED`, adjustment **−30**
- [ ] **A04**: import covers the date with no punches → `REVERSED`, adjustment **−600**
- [ ] **A05**: an import that does **not** cover the date → credit stays `ADVANCED`. This includes a batch whose range ends before the date, a batch whose range starts after it, and a batch from a device the employee isn't mapped to.
- [ ] Re-evaluation: after A04, a second import (an overlapping export) brings 07:00, 12:00, 14:00, 19:00 for the date → the credit is restored (+600 via BE-032), history `CREATED → REVERSED → RESTORED`
- [ ] Committing a batch with 142 reversals for one date → the summary shows `142 reversed` for that date, plus the data-gap warning when it's above the threshold
- [ ] The catch-up command run twice gives the same final state and no duplicate events
- [ ] The commit still succeeds if reconciliation throws (the error is logged and the catch-up fixes it)
- [ ] `advance_credit_events` history for A04 reads `CREATED → REVERSED`

## 5. Tests
- Unit: outcome mapping per §12 (table-driven: A02–A05).
- Int (Testcontainers): commit → reconcile end to end, coverage window, idempotency, failure isolation, append-only events.
- API: commit response summary.

## 6. References
[[CVSU-DTR/v3/BUSINESS-RULES]] §12 · [[CVSU-DTR/v3/DATABASE-MAPPING]] §8 · [[CVSU-DTR/v3/README]] ADR-23, ADR-24 · [[CVSU-DTR/HR-Requirements-Analysis]] D-HR-07, D-HR-08, D-HR-19, §8.2 (mass reversals), §8.6 A02–A05
