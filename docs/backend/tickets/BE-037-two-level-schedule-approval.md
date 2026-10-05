---
id: BE-037
title: Two-level schedule approval + mid-semester changes
type: Feature
priority: P1
status: TODO
epic: E7 Phase 1B approvals & balances
module: schedules
week:
day:
estimate_h: 8
depends_on: [BE-007]
blocked_by: []
phase: 1B
tags: [cvsu-dtr, backend, ticket, v3, placeholder]
---

# BE-037 — Two-level schedule approval + mid-semester changes

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-database`

> [!note] Phase 1B placeholder
> Phase 1 stop-gap (BE-007): HR enters schedules directly as `APPROVED` (audited). Open item O-3 (effective date of a change) uses its default: the requested date, but not earlier than the start of the first **non-finalized** period ⚠.

## 1. Background & problem
HR answers Q-S1, Q-S2 and C-10 (D-HR-16, D-HR-21): schedules need approval, and mid-semester changes go through **Head → HR** (ADR-28, which extends ADR-08). Rules: [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] §6.

## 2. Objective
Schedule workflow `DRAFT → SUBMITTED → ENDORSED → APPROVED | REJECTED`, with superseding from the effective date.

## 3. Scope
**In**
- [ ] Submit, endorse, approve and reject endpoints ⚠ (per API-DESIGN §5.5), with maker-checker at both levels
- [ ] Effective date guard (O-3). Dates covered by FINALIZED DTRs stay locked (`SCHEDULE_LOCKED`).
- [ ] Approval marks the affected days stale. If a credited date's schedule changes, re-reconcile per BUSINESS-RULES §12 ⚠ (analysis §3.2 edge case).

## 4. Acceptance criteria
- [ ] A Head-endorsed, HR-approved change supersedes the old schedule from the effective date
- [ ] An effective date inside a finalized period → rejected
- [ ] Endorser = requester → rejected

## 5. References
[[CVSU-DTR/v3/BUSINESS-RULES]] §6 · [[CVSU-DTR/v3/README]] ADR-08, ADR-28 · [[CVSU-DTR/HR-Requirements-Analysis]] D-HR-16, D-HR-21, §8.7 O-3
