---
id: BE-032
title: Carry-forward ledger (carry_forward_adjustments) + prior-period adjustments on the DTR + restore
type: Feature
priority: P0
status: TODO
epic: E6 Reconciliation & carry-forward
module: advance-credits / dtr
week: 5
day: 2026-11-05
estimate_h: 6
depends_on: [BE-031, BE-030, BE-024]
blocked_by: []
phase: 1B
tags: [cvsu-dtr, backend, ticket, never-cut, v3, hard-date]
---

# BE-032 — Carry-forward ledger + prior-period adjustments on the DTR + restore

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-database`

> [!danger] Phase 1B · hard date **Wed Nov 11, 2026** (same as BE-031)
> A reconciled deduction is useless until it appears on the next DTR. Target done **Fri Nov 6**.

## 1. Background & problem
A signed, finalized DTR is **never** changed (ADR-13, ADR-25). HR answers Q-A3, C-02, Q-A7 and C-11 (D-HR-06, D-HR-09, D-HR-18, D-HR-22) say:
- deductions from adjusted or reversed credits go to the **next** semi-monthly DTR;
- a request approved later **restores** the minutes, also through the next open DTR.

ADR-25 puts every carry-forward in **one append-only ledger**, `carry_forward_adjustments`, whatever its source:
- `ADVANCE_CREDIT`
- `MAKEUP_CLASS` (BE-036)
- `LATE_EXCEPTION`: approved or recorded after the DTR was finalized, on a day with no credit
- `MANUAL`

`dtrs.prior_period_adjustment_minutes` is the SUM of the rows applied to that period. If the source DTR is **not** finalized yet, the day is simply recalculated there and **no** row is created.
Rules: [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] §12.

## 2. Objective
- Create the ledger.
- Write a row for every non-zero adjustment to a finalized DTR's day, targeted at the next open period.
- Show and print the rows as **prior-period adjustments** on that DTR.
- Provide the positive **restore** path.

## 3. Scope
**In**
- [ ] Migration ⚠ (number and exact columns per [[CVSU-DTR/v3/DATABASE-MAPPING|DATABASE-MAPPING]] §8–§9): `carry_forward_adjustments` with:
  - source type `ADVANCE_CREDIT | MAKEUP_CLASS | LATE_EXCEPTION | MANUAL` and the source FK (`advance_credit_id`, the make-up `exception_id`, or `exception_id`)
  - `employee_id`, `source_date`, `source_dtr_period_id`, `applied_in_dtr_period_id`, signed `minutes`, `trigger`, `actor_user_id`, `remarks`, `created_at`
  - 🔒 `REVOKE UPDATE, DELETE, TRUNCATE … FROM app_user`. Corrections are new rows, never edits.
- [ ] `CarryForwardService.post({ source, employeeId, sourceDate, minutes, trigger, actor })`:
  - target = the next period after the source period in which the employee's DTR is **not FINALIZED** (D-HR-18);
  - if that period doesn't exist yet, it's attached when the period is created ⚠ §12;
  - the source DTR still DRAFT → no row; the caller recalculates the day instead (ADR-25).
- [ ] BE-031 outcomes `ADJUSTED` / `REVERSED` → `post(ADVANCE_CREDIT, −minutes)`. `advance_credits.applied_in_dtr_period_id` and the event row point to the same period.
- [ ] `restore(creditId | exceptionId, { trigger, actor })` → **positive** row. For a credit: → `RECONCILED`, event `RESTORED`. Used by:
  - BE-031 re-evaluation (later import with punches, ADR-24);
  - BE-033 (late approvals);
  - the interim trigger below.
- [ ] Interim trigger before 1B approvals exist: a BE-021 day remark (e.g. a paper-approved WELLNESS) on a date of a **FINALIZED** DTR is now allowed, instead of returning `EXCEPTION_PERIOD_LOCKED`.
  - On a credited date → `restore` (`ADVANCE_CREDIT`).
  - On a day without a credit → `post(LATE_EXCEPTION, +minutes)` (D-HR-22).
- [ ] `GenerateDtrsUseCase` (BE-019): `dtrs.prior_period_adjustment_minutes` = Σ `minutes` of the rows applied to this period
- [ ] DTR detail (BE-020): `adjustments[]` = `{ sourceType, sourceDate, fromPeriod, minutes, trigger }`
- [ ] **Form 48 (BE-023): print "Prior-period adjustments"**: one line per row (e.g. "Oct 30 (advance credit): −30 min") and the total. The wording and where it sits on the form follow BUSINESS-RULES §12 / O-6 ⚠. Check it in a BE-026-style print test.
- [ ] Reopen guard (BE-024): reopening a DTR whose days are the **source** of ledger rows applied to another period is rejected ⚠ (error code per API-DESIGN §9). This prevents counting a deduction twice.
- [ ] Audit `CARRY_FORWARD_POSTED`, `ADVANCE_CREDIT_RESTORED` ⚠ (action names per DATABASE-MAPPING §10)

**Out**
- Approval workflows that call `restore` (BE-033), make-up outcomes that call `post` (BE-036)
- Payroll export of adjustments (Phase 3)

## 4. Acceptance criteria
- [ ] **A03**: one `ADVANCE_CREDIT` row of −30 applied to Sept 16–30. That DTR has `prior_period_adjustment_minutes = −30`, and the line is printed.
- [ ] **A04**: a −600 row applied to Sept 16–30
- [ ] **A06** (interim trigger): after A04, HR records a paper-approved WELLNESS for the date →
  - a +600 row in the next open period;
  - credit `RECONCILED` (trigger `EXCEPTION_APPROVED`);
  - credit history `CREATED → REVERSED → RESTORED`;
  - ledger total for the date = 0.
- [ ] Chained case (analysis §8.2): the restore happens after Sept 16–30 is finalized → +600 lands on Oct 1–15, and Sept 16–30 is unchanged
- [ ] A late remark on a non-credited day of a finalized DTR → a `LATE_EXCEPTION` row; source DTR still DRAFT → no row, the day is recalculated
- [ ] `UPDATE carry_forward_adjustments` as `app_user` → permission denied
- [ ] The signed DTR (Sept 1–15) is byte-identical before and after (stored SHA-256 unchanged)
- [ ] Reopening Sept 1–15 after its deduction was carried forward → rejected

## 5. Tests
- Unit: target-period selection (including the next DTR already being finalized, and no next period yet).
- Int: ledger append-only grant, totals on regenerate, restore, reopen guard.
- API: DTR detail `adjustments[]`.
- Render: adjustment lines on the PDF.

## 6. References
[[CVSU-DTR/v3/BUSINESS-RULES]] §12 · [[CVSU-DTR/v3/DATABASE-MAPPING]] §8–§9 · [[CVSU-DTR/v3/README]] ADR-13, ADR-24, ADR-25 · [[CVSU-DTR/HR-Requirements-Analysis]] D-HR-06, D-HR-09, D-HR-18, D-HR-22, §8.6 A03, A04, A06
