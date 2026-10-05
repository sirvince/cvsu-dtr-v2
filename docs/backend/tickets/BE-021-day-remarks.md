---
id: BE-021
title: Day remarks → approved exceptions (Should)
type: Feature
priority: P2
status: TODO
epic: E3 DTR generation
module: attendance (exceptions)
week: 3
day: 2026-10-22
estimate_h: 3
depends_on: [BE-019]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket, cut-list]
---

# BE-021 — Day remarks → approved exceptions

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-database`

> [!warning] Cut list #1 — first to cut if behind.

## 1. Background & problem
HR needs to mark a day as Leave / OB / Holiday with a remark so it is excused on regenerate. Raw punches must **never** be edited to do this.

## 2. Objective
`PUT /dtrs/:id/days/:date/remark { type: LEAVE|OB|NOTE, scope?: WHOLE_DAY|AM|PM, subtype?, text }` creates an `attendance_exceptions` row (Phase 1: status `APPROVED`, `reviewed_by = null` so the maker-checker CHECK still holds) and regenerates that DTR.

## 3. Scope
**In**
- [ ] Map `LEAVE` → `LEAVE` (subtype VL/SL/…), `OB` → `OFFICIAL_BUSINESS`, `NOTE` → `MANUAL_REMARK`; `HOLIDAY` is not offered here: holidays are calendar events (BE-000 D12)
- [ ] Wire `ExceptionApplier` with real data (whole day, AM, PM)
- [ ] Remove remark (`DELETE …/remark`) → exception `REVOKED`
- [ ] Only for DRAFT DTRs; FINALIZED → `422 EXCEPTION_PERIOD_LOCKED`
- [ ] Printed remarks: `VL`, `SL`, `OB`, … (BUSINESS-RULES Q16)
- [ ] Audit `EXCEPTION_CREATED` / `EXCEPTION_REVOKED`

**Out**
- Maker-checker approval, time corrections, attachments (1B)

## 4. Acceptance criteria
- [ ] **T11** (whole-day OB) and **T14** (AM VL) pass end-to-end
- [ ] Raw punches unchanged after adding a remark

## 5. References
[[CVSU-DTR/v3/BUSINESS-RULES]] §8 · [[CVSU-DTR/v3/PHASE1-MVP-1-MONTH]] §2, §5
