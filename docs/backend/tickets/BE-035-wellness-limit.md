---
id: BE-035
title: Wellness limit (4 whole days per academic year)
type: Feature
priority: P1
status: TODO
epic: E7 Phase 1B approvals & balances
module: attendance (exceptions)
week:
day:
estimate_h: 3
depends_on: [BE-033]
blocked_by: []
phase: 1B
tags: [cvsu-dtr, backend, ticket, v3, placeholder]
---

# BE-035 — Wellness limit (4 whole days per academic year)

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skill: `dtr-backend`

> [!note] Phase 1B placeholder
> Phase 1 already enforces **whole day only** on paper-approved WELLNESS remarks (BE-021). It doesn't enforce the 4-day limit, because the paper approval already checked it.

## 1. Background & problem
HR answers Q-R4 and C-06 (D-HR-13): WELLNESS is at most **4 whole days per academic year** (ADR-30). Rules: [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] §8.

## 2. Objective
Enforce the limit at endorsement and at approval: approved + pending wellness days in the academic year + requested ≤ 4.

## 3. Scope
**In**
- [ ] `WellnessLimitPolicy` (domain). The limit value comes from config / the rule set, not a constant.
- [ ] Count per `academic_years` row, including Phase 1 paper-approved WELLNESS remarks
- [ ] Error `WELLNESS_LIMIT_REACHED` at endorse and approve; `WELLNESS_WHOLE_DAY_ONLY` at submit

## 4. Acceptance criteria
- [ ] **R03**: 4 wellness days already approved this academic year, a 5th requested → endorse/approve rejected `WELLNESS_LIMIT_REACHED`
- [ ] **R05**: WELLNESS for AM only → rejected at submission `WELLNESS_WHOLE_DAY_ONLY`
- [ ] Days in the previous academic year don't count

## 5. References
[[CVSU-DTR/v3/BUSINESS-RULES]] §8 · [[CVSU-DTR/v3/README]] ADR-30 · [[CVSU-DTR/HR-Requirements-Analysis]] D-HR-13, §8.6 R03, R05
