---
id: BE-034
title: Offset earning requests + offset ledger + semester-end expiry
type: Feature
priority: P1
status: TODO
epic: E7 Phase 1B approvals & balances
module: attendance (offset)
week:
day:
estimate_h: 10
depends_on: [BE-033]
blocked_by: []
phase: 1B
tags: [cvsu-dtr, backend, ticket, v3, placeholder]
---

# BE-034 — Offset earning requests + offset ledger + semester-end expiry

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-database`

> [!note] Phase 1B placeholder
> Re-estimate at 1B planning. Open item O-5 (must the claimed overtime have punches?) uses its default: the punches are shown to the approver, and a mismatch is a warning, not a block ⚠.

## 1. Background & problem
HR answers Q-R3 and C-05 (D-HR-12):
- OFFSET uses a **balance** of earned hours;
- earned hours are approved by the **Head/Dean**;
- they **expire at the end of the semester** they were earned in.

Like advance credits, the ledger is a set of point-in-time decisions and is not rebuilt by reprocessing (ADR-23, ADR-29).
Rules: [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] §8.

## 2. Objective
Employees request earned offset hours and the Head/Dean approves them; approval writes `EARNED` to `offset_ledger`. Approving an OFFSET checks the balance and writes `USED`. A semester-end job writes `EXPIRED`.

## 3. Scope
**In**
- [ ] `offset_earning_requests` and `offset_ledger` (DATABASE-MAPPING §7 ⚠). Submit, approve and reject for earning requests (one level, Head/Dean). Maker-checker applies.
- [ ] The approval screen data includes the employee's raw punches for `work_date` (O-5)
- [ ] Balance = Σ `minutes` per (employee, semester). OFFSET approval (BE-033) rejects with `OFFSET_BALANCE_INSUFFICIENT` and writes `USED` on success. A revoke writes `REVERSED`.
- [ ] Semester-end expiry job (pg-boss or cron), idempotent per semester
- [ ] Backfill: Phase 1 paper-approved OFFSET remarks → `USED` entries after HR confirms the opening balances ⚠
- [ ] Audit `OFFSET_EARNED`, `OFFSET_EXPIRED`

## 4. Acceptance criteria
- [ ] **R04**: balance 120 min, OFFSET requested for 300 min → approval rejected `OFFSET_BALANCE_INSUFFICIENT`
- [ ] **R06**: 240 min earned in the 1st semester and unused → the semester-end job writes `EXPIRED −240`; the 2nd-semester balance is 0
- [ ] The expiry job run twice → one `EXPIRED` row

## 5. References
[[CVSU-DTR/v3/BUSINESS-RULES]] §8 · [[CVSU-DTR/v3/DATABASE-MAPPING]] §7 · [[CVSU-DTR/v3/README]] ADR-29 · [[CVSU-DTR/HR-Requirements-Analysis]] D-HR-12, §8.4, §8.6 R04, R06, §8.7 O-5
