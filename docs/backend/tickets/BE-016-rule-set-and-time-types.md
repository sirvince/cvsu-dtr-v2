---
id: BE-016
title: Rule set + LocalDate/LocalTime + migration 0006
type: Task
priority: P0
status: TODO
epic: E3 DTR generation
module: attendance (domain)
week: 3
day: 2026-10-19
estimate_h: 2
depends_on: [BE-003]
blocked_by: [P4 HR answers Q1–Q5]
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-016 — Rule set + time types + migration 0006

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-database`

> [!warning] Uses P4
> Rule values (office hours, grace, lunch punches, undertime column, half-day) come from HR's answers to Q1–Q5. If missing, use the BUSINESS-RULES defaults — they're config, so they can change later **without code changes**.

## 1. Background & problem
Attendance math must read every policy value from a **versioned rule set** (ADR-09), never from constants. The domain also needs safe local date/time types (no JS `Date` math).

## 2. Objective
`RuleSet` value object loaded from `attendance_rule_sets`, seeded `DEFAULT v1`, plus the tables the calculator writes to.

## 3. Scope
**In**
- [ ] Migration `0006_rules_exceptions_processing`: `attendance_rule_sets` (+ published-immutable trigger), `attendance_exceptions` (with maker-checker CHECK — kept even though Phase 1 creates them as APPROVED), `processing_jobs`, `processed_attendance`
- [ ] Domain `RuleSet` (typed config from BUSINESS-RULES §5.1, validated with Zod when loaded): `strategy, grace_minutes, grace_mode, seconds_mode, double_tap_minutes, lunch_punch_required, noon_boundary, undertime_column, half_day_absence_as, missing_punch_blocks_validation, early_window_min, late_window_min`
- [ ] `RuleSetResolver.for(employee, date)` (PUBLISHED, effective dates, category/employment type)
- [ ] Seed `DEFAULT v1` with P4 values (or defaults), status `PUBLISHED` for Phase 1 with HR's written OK
- [ ] `LocalTime` helpers needed by the calculator: `minutesBetween`, `truncateSeconds`, compare, `addMinutes`

**Out**
- Rule-set editor / simulator API (1B)

## 4. Acceptance criteria
- [ ] Updating `config` of a PUBLISHED rule set → DB error (`RULESET_PUBLISHED_IMMUTABLE`)
- [ ] Invalid config JSON fails loading with a clear error
- [ ] No hard-coded `08:00`, grace or boundary values in domain code (grep check in review)

## 5. Tests
Unit: RuleSet parsing, resolver selection. Int: immutability trigger.

## 6. References
[[CVSU-DTR/v3/BUSINESS-RULES]] §5.1, §11 · [[CVSU-DTR/v3/DESIGN-PATTERNS]] §3 · [[CVSU-DTR/v3/DATABASE-MAPPING]] §7–§8
