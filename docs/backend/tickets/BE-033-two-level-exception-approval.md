---
id: BE-033
title: Two-level exception approval (OFFSET, WELLNESS, MAKE_UP_CLASS)
type: Feature
priority: P1
status: TODO
epic: E7 Phase 1B approvals & balances
module: attendance (exceptions)
week:
day:
estimate_h: 12
depends_on: [BE-021, BE-032]
blocked_by: []
phase: 1B
tags: [cvsu-dtr, backend, ticket, v3, placeholder]
---

# BE-033 — Two-level exception approval (OFFSET, WELLNESS, MAKE_UP_CLASS)

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-security`, `dtr-database`

> [!note] Phase 1B placeholder
> Re-estimate and schedule at 1B planning. It needs the 1B **roles and department scopes** (`DEPARTMENT_HEAD`, `EMPLOYEE`, `/me/*`), which are not ticketed yet. Phase 1 stop-gap: HR records paper-approved requests as day remarks (BE-021).

## 1. Background & problem
HR answers Q-R5, C-09 and C-11 (D-HR-14, D-HR-20, D-HR-22):
- OFFSET and WELLNESS are **endorsed by the Department Head, then approved by HR**;
- MAKE_UP_CLASS is approved by the **Head only** (O-2 ⚠);
- maker-checker applies at every level (ADR-11, ADR-28);
- requests approved after the DTR is finalized are applied to the next DTR.

Rules: [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] §8.

## 2. Objective
The exception workflow `PENDING → ENDORSED → APPROVED`, with rejection or cancellation at either level, for the new types. Late approvals re-reconcile credited dates.

## 3. Scope
**In**
- [ ] Endpoints to submit, endorse, approve, reject and cancel ⚠ (per [[CVSU-DTR/v3/API-DESIGN|API-DESIGN]] §5.8); scope checks per department
- [ ] Guards:
  - requester ≠ endorser, requester ≠ approver (API + DB CHECK);
  - `rejected_level`;
  - per-type approval levels from config, not hard-coded (O-2)
- [ ] Approval marks the affected days stale. If the date has an `ADVANCED` / `REVERSED` / `ADJUSTED` credit, call `AdvanceCreditService.restore` / re-reconcile (BE-032, D-HR-09).
- [ ] Approval for a date in a FINALIZED DTR → a positive row in `carry_forward_adjustments` (BE-032): `ADVANCE_CREDIT` restore on a credited date, otherwise `LATE_EXCEPTION` (D-HR-22, ADR-25)
- [ ] Migrate Phase 1 paper-approved remarks: keep them as `APPROVED` with their reference
- [ ] Audit `EXCEPTION_ENDORSED` / `_APPROVED` / `_REJECTED`

**Out**
- Balance and limit checks (BE-034, BE-035), make-up outcome processing (BE-036)

## 4. Acceptance criteria
- [ ] **R01**: an approved OFFSET for the AM group overrides the 08:30 punch → AM from the schedule, tardy 0
- [ ] **A06**: after A04, WELLNESS approved → +600 in the next open period, credit `RECONCILED` (trigger `EXCEPTION_APPROVED`)
- [ ] Endorser = requester → rejected (API and DB)
- [ ] HR approving a request that wasn't endorsed (where endorsement is required) → `422`

## 5. References
[[CVSU-DTR/v3/BUSINESS-RULES]] §8, §12 · [[CVSU-DTR/v3/README]] ADR-11, ADR-27, ADR-28 · [[CVSU-DTR/HR-Requirements-Analysis]] D-HR-14, D-HR-15, D-HR-20, D-HR-22, §8.6 R01, A06
