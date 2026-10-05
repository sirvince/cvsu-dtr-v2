---
id: BE-000
title: Resolve Phase 1 design gaps (ADR)
type: Chore
priority: P0
status: TODO
epic: E0 Design gaps
module: docs
week: 1
day: 2026-10-05
estimate_h: 2
depends_on: []
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-000 — Resolve Phase 1 design gaps (ADR)

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]]

> [!info] v3 changes (2026-10-05)
> - **ADR-21 … ADR-32 are taken** by the HR decisions (see [[CVSU-DTR/v3/README|README]] §2). Record D1–D15 as **ADR-33 onward**.
> - New v3 gaps **D13–D15** (advance re-runs, the advance endpoint shape, the paper-approval stop-gap) are added below.
> - D11 now also says that Phase 1B starts with the hard-dated reconciliation tickets (BE-031/032).
> - Timebox unchanged (2 h).

## 1. Background & problem
The Phase 1 plan ([[CVSU-DTR/v3/PHASE1-MVP-1-MONTH|PHASE1-MVP]]) simplifies the full v3 design, but some simplifications aren't written into the owner docs. Without decisions, code will drift from the docs on day 1.

## 2. Objective
Decide each gap below, record it in the README ADR table, and update the owner doc. **Timebox: 2 hours.** Take the recommended option unless HR/adviser says otherwise.

## 3. Decisions to make

| # | Gap | Recommended decision | Update |
|---|---|---|---|
| D1 | Phase 1 DTR goes `DRAFT → FINALIZED` directly; BUSINESS-RULES §7 only allows finalize from `VALIDATED` | Add a **Phase 1 transition table**: `finalize: DRAFT→FINALIZED`, `reopen: FINALIZED→DRAFT` (reason, version+1). Swap to the full table in 1B; data stays compatible | BUSINESS-RULES §7, API-DESIGN §5.9 |
| D2 | Phase 1 `/dtrs/:id/unlock` vs canonical `/dtrs/:id/reopen` | Use **`/dtrs/:id/reopen`** (same semantics). UI label can still say "Unlock" | PHASE1-MVP §5 |
| D3 | Phase 1 endpoints missing in API-DESIGN: `/schedules/assign`, `PUT /dtrs/:id/days/:date/remark`, `POST /dtrs/download`, `GET /attendance-imports/:id/unmatched` | Add them to API-DESIGN marked "Phase 1" | API-DESIGN §5 |
| D4 | Upload validates synchronously (Phase 1) vs `202` job (API-DESIGN) | Phase 1: `POST /attendance-imports` returns `201` with status `VALIDATED`/`REJECTED` + summary. Keep the response shape the same so 1B can switch to `202` | API-DESIGN §5.6 |
| D5 | Bulk PDF in one synchronous request may time out | Render each PDF **at finalize** (or lazily on first download) and store it; bulk download only **zips stored files**. Cap bulk at one department; Nginx `proxy_read_timeout 300s` | STACK §7, PHASE1-MVP §3 |
| D6 | `dtrs.version` / `employee_schedules.version` vs TypeORM `@VersionColumn` | Add `row_version` (optimistic lock) separate from the business `version` | DATABASE-MAPPING §5, §9 |
| D7 | `half_days_absent` total missing on `dtrs` | Add `half_days_absent numeric(4,1)` | DATABASE-MAPPING §9 |
| D8 | `Idempotency-Key` table undefined | Phase 1: rely on natural keys + state (commit of a COMMITTED batch returns its stored result; finalize of a FINALIZED DTR returns 200 no-op). Define `idempotency_keys` in 1B | DESIGN-PATTERNS §7 |
| D9 | Audit log migration is `0008`, but Phase 1 audits from week 1 | Move `audit_logs` into `0001_init_users_auth` | DATABASE-MAPPING §13 |
| D10 | DATABASE-MAPPING says PostgreSQL 16+, STACK says 17+ | **PostgreSQL 17** | DATABASE-MAPPING header |
| D11 | Two schedules (DEVELOPMENT-PHASES sprints vs Phase 1 month) | Mark DEVELOPMENT-PHASES §3–§4 as superseded for dates; keep it as the 1B content reference. *v3:* Phase 1B starts Mon Nov 2 with BE-031/032 (reconciliation, hard date Nov 11) | DEVELOPMENT-PHASES |
| D12 | Phase 1 "HOLIDAY" day remark (BE-021) vs `calendar_events` (affects everyone) | A holiday is always a **calendar event**. The per-DTR remark offers LEAVE / OB / NOTE, plus in v3 ASYNCHRONOUS and the paper-approved OFFSET / WELLNESS / MAKE_UP_CLASS (D15). A NOTE never changes the calculation. GOVERNMENT_ANNOUNCEMENT is a calendar event too (ADR-27). | PHASE1-MVP §5, BUSINESS-RULES §8 |
| D13 | *v3:* re-running processing on a **DRAFT** DTR that already has advance credits | ⚠ Credits become binding only when the DTR is **finalized**. On a DRAFT DTR, a re-run cancels the `ADVANCED` credits that are no longer needed: all of them on a FULL run, or those on or before the new `processed_until` on an ADVANCE run. Each one gets a `CANCELLED` event. Reconciliation (BE-031) handles only credits of FINALIZED DTRs. | BUSINESS-RULES §12 (owner confirms) |
| D14 | *v3:* the Phase 1 endpoint for advance processing | Extend `POST /dtr-periods/:id/generate-dtrs { departmentId?, processedUntil? }`. `processedUntil` present means `ADVANCE`. No separate endpoint. | API-DESIGN §5.7 |
| D15 | *v3:* the Phase 1 stop-gap for OFFSET / WELLNESS / MAKE_UP_CLASS (no Head/employee logins) | HR records **paper-approved** requests as typed day remarks: `APPROVED`, with a paper reference in `review_remarks` ⚠. MAKE_UP_CLASS stores the letter scan and `makeup_class_details` (`outcome = PENDING`). There are no balance or limit checks (BE-034/035 backfill), but WELLNESS is whole-day only. | BUSINESS-RULES §8, API-DESIGN §5.9 |

## 4. Acceptance criteria
- [ ] D1–D15 each have a decision recorded in [[CVSU-DTR/v3/README|README]] §2 as new ADR rows **from ADR-33** (ADR-21 … ADR-32 are the HR decisions)
- [ ] Owner docs updated in the same change
- [ ] `dtr-backend` / `dtr-database` skills still agree with the docs

## 5. References
[[CVSU-DTR/v3/PHASE1-MVP-1-MONTH]] · [[CVSU-DTR/v3/BUSINESS-RULES]] · [[CVSU-DTR/v3/API-DESIGN]] · [[CVSU-DTR/v3/DATABASE-MAPPING]] · [[CVSU-DTR/HR-Requirements-Analysis]] §8
