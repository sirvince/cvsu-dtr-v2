---
id: BE-024
title: Finalize / unlock + history + freeze trigger
type: Feature
priority: P0
status: TODO
epic: E4 PDF, finalize, deploy
module: dtr
week: 4
day: 2026-10-27
estimate_h: 3
depends_on: [BE-019, BE-023]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-024 — Finalize / unlock + history + freeze trigger

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-database`

> [!warning] Unlock is cut list #4 (DB fix by admin). Finalize is P0.

## 1. Background & problem
After HR checks a DTR it must be **locked**: items frozen, PDF stored, attendance dates protected from reprocessing. Unlocking needs a reason and creates a new version (acceptance **A10**).

## 2. Objective
Phase 1 transition table (BE-000 D1): `finalize: DRAFT → FINALIZED`, `reopen: FINALIZED → DRAFT`.

## 3. Scope
**In**
- [ ] `dtrMachine` (Phase 1 table) using `makeMachine()` from BE-002
- [ ] `POST /dtrs/:id/finalize` (`If-Match: rowVersion`): lock row `FOR UPDATE` → transition → items already current (regenerate first if stale) → set `FINALIZED`, `finalized_by/at` → history + audit `DTR_FINALIZED` → commit → render PDF (BE-023, D5 decision) → return `{ status, version, document }`
- [ ] Finalizing an already FINALIZED DTR → `200` no-op (idempotent)
- [ ] `POST /dtrs/:id/reopen { reason }` (UI label "Unlock"): reason required → `DRAFT`, `version + 1`, old document `SUPERSEDED`, history + audit `DTR_REOPENED`
- [ ] Bulk: `POST /dtrs/bulk/finalize { dtrIds[] }` → `{ succeeded[], failed[{ id, code }] }` (one transaction per DTR)
- [ ] `dtr_items_frozen` trigger active (from 0007); generate skips FINALIZED (BE-019); schedule assign rejects locked dates `SCHEDULE_LOCKED` (BE-007)

**Out**
- FOR_REVIEW / VALIDATED / SUBMITTED / RECEIVED states (1B)

## 4. Acceptance criteria
- [ ] Finalize → regenerate attempt leaves the DTR unchanged (**A10**)
- [ ] Reopen without reason → `400`/`422`; with reason → DRAFT, version 2
- [ ] Writing `dtr_items` of a FINALIZED DTR via SQL → trigger error
- [ ] Stale `If-Match` → `409 CONCURRENT_MODIFICATION`
- [ ] Invalid transition → `422 DTR_INVALID_TRANSITION`

## 5. Tests
Unit: Phase 1 transition table (all pairs). Int: freeze trigger. API: finalize/reopen/bulk + error codes.

## 6. References
[[CVSU-DTR/v3/BUSINESS-RULES]] §7 · [[CVSU-DTR/v3/DATABASE-MAPPING]] §9 · [[CVSU-DTR/v3/DESIGN-PATTERNS]] §4, §7
