---
id: BE-020
title: DTR list + detail API
type: Feature
priority: P1
status: TODO
epic: E3 DTR generation
module: dtr
week: 3
day: 2026-10-22
estimate_h: 2
depends_on: [BE-019]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-020 — DTR list + detail API

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skill: `dtr-backend`

## 1. Objective
Endpoints for the DTR table and the Form 48 preview screen.

## 2. Scope
**In**
- [ ] `GET /dtrs?dtrPeriodId&departmentId&status&q&page&limit&sort` → employee, days present/absent, tardy count/minutes, undertime, blocking flag count, status, version
- [ ] `GET /dtrs/:id` → header (employee, department, period, status, version), `items[]` for every date of the month (`workDate, amIn, amOut, pmIn, pmOut, undertimeHours, undertimeMins, dayStatus, flags, remarks`), totals, `history[]`, `documents[]`
- [ ] `GET /attendance/:id` (processed day with used/ignored punches + trace) for the "Why?" drawer
- [ ] Times as `HH:mm`, dates `YYYY-MM-DD`; known-empty = `null`
- [ ] Audit `DTR_VIEWED` (cheap now; required in 1B for non-subject viewers)
- [ ] `GET /dtr-periods/:id/attention` (minimal): unmatched IDs, employees without schedule, blocking days — feeds dashboard warnings (cut list ⑤)

## 3. Acceptance criteria
- [ ] Detail returns 28–31 rows matching the month, including rest days and holidays
- [ ] Unknown id → `404 DTR_NOT_FOUND`
- [ ] List pagination and whitelisted sort work

## 4. References
[[CVSU-DTR/v3/API-DESIGN]] §5.7, §5.9, §6 · [[CVSU-DTR/v3/UI_DESIGN]] §6.2
