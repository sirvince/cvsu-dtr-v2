---
id: BE-017
title: PunchNormalizer + SlotAssigner (T01–T07)
type: Feature
priority: P0
status: TODO
epic: E3 DTR generation
module: attendance (domain)
week: 3
day: 2026-10-19
estimate_h: 4
depends_on: [BE-016]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket, never-cut]
---

# BE-017 — PunchNormalizer + SlotAssigner

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-testing`

## 1. Background & problem
CSC Form 48 has four slots per day (AM in/out, PM in/out). Raw punches include double taps and stray scans, and the device's in/out "state" is not reliable.

## 2. Objective
Pure TypeScript domain services that turn a day's punches into the four slots, exactly per BUSINESS-RULES §4.

## 3. Scope
**In**
- [ ] `PunchNormalizer`: truncate seconds → sort → double-tap removal (`double_tap_minutes`) → day window (`early_window_min`, `late_window_min`) → `PUNCH_OUTSIDE_WINDOW`; returns `kept` and `ignored` (with reason)
- [ ] Schedule grouping: AM/PM groups, noon boundary = midpoint (or `rule.noon_boundary`)
- [ ] `SlotAssigner`: before/after boundary rules, single-PM-punch rule, single-group day, no-lunch-punch day
- [ ] Device state column ignored
- [ ] Zero imports from Nest/TypeORM/ExcelJS (lint rule `no-restricted-imports` on `domain/**`)
- [ ] Copy `day-calculator.cases.ts` from the `dtr-testing` skill into `domain/__tests__/`

## 4. Acceptance criteria
- [ ] Slot columns of **T01–T07** match BUSINESS-RULES §10 exactly
- [ ] T05: 07:51 is ignored as a double tap
- [ ] Device-state swap doesn't change slots

## 5. Tests
Table-driven Jest from the cases file (slots only at this stage) + edge tests (empty day, one punch, punches all after boundary).

## 6. References
[[CVSU-DTR/v3/BUSINESS-RULES]] §4, §10 · [[CVSU-DTR/v3/DESIGN-PATTERNS]] §2
