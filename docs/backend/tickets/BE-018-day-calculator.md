---
id: BE-018
title: "DayCalculator: FIXED strategy, status, flags, trace"
type: Feature
priority: P0
status: TODO
epic: E3 DTR generation
module: attendance (domain)
week: 3
day: 2026-10-20
estimate_h: 6
depends_on: [BE-017]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket, never-cut]
---

# BE-018 — DayCalculator: FIXED strategy, status, flags, trace

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-testing`

> [!important] Never cut — this is the product
> The success measure is **0 discrepancies** against the HR test table (REQUIREMENTS §2).

## 1. Background & problem
Tardiness, undertime, worked minutes and day status must follow the written formulas, be deterministic, and be explainable to HR ("why 15 min late?").

## 2. Objective
`DayCalculator.calculate(DayInput) → DayResult` implementing BUSINESS-RULES §5 for the FIXED strategy.

## 3. Scope
**In**
- [ ] `CalendarApplier`: holiday / special non-working → `HOLIDAY`; full suspension → `SUSPENDED`; partial suspension (`startTime`) excuses time after it + `PARTIAL_SUSPENSION`
- [ ] `ExceptionApplier` interface (whole-day/AM/PM leave & OB; slot corrections) — real data wired in BE-021
- [ ] `FixedScheduleStrategy`: tardiness (both grace modes), early-out, undertime (`undertime_column`, `half_day_absence_as`), worked minutes (overlap with groups; no-lunch case)
- [ ] `StatusResolver`: priority order NO_SCHEDULE → REST_DAY → HOLIDAY/SUSPENDED → ON_LEAVE/OB → ABSENT → HALF_DAY_ABSENT → INCOMPLETE → LATE_UNDERTIME/LATE/UNDERTIME → PRESENT; flags `MISSING_*`; `isBlocking`
- [ ] `trace: TraceStep[]` explaining each number
- [ ] `inputFingerprint` = SHA-256 of canonical JSON of all inputs (computed in the application layer)

**Out**
- FLEXI strategy (Phase 2; X01–X03 tests can stay `it.todo`)

## 4. Acceptance criteria
- [ ] **T01–T10, T13, T16** pass (Phase 1 required set); T09 holiday; T12 if suspensions are entered
- [ ] **G01–G03** grace variants pass
- [ ] Same input twice → identical result
- [ ] `08:00:59` is not late
- [ ] Domain branch coverage ≥ 90%

## 5. Tests
Table-driven Jest from `day-calculator.cases.ts` (see `dtr-testing` skill) + parameter-effect tests (each rule value changes the result as documented).

## 6. References
[[CVSU-DTR/v3/BUSINESS-RULES]] §5, §10 · [[CVSU-DTR/v3/DESIGN-PATTERNS]] §2–§3
