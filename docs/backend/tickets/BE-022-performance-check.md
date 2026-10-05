---
id: BE-022
title: Performance check (1,000 employees × 1 month)
type: Task
priority: P1
status: TODO
epic: E3 DTR generation
module: attendance (processing)
week: 3
day: 2026-10-23
estimate_h: 2
depends_on: [BE-019]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-022 — Performance check + week-3 demo

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skill: `dtr-testing`

## 1. Objective
Confirm generation is fast enough to run synchronously, and run the **Fri Oct 23 demo**: HR compares 10 generated DTRs with their manual computation.

## 2. Scope
**In**
- [ ] Synthetic load: 1,000 employees × 31 days × ~4 punches (~120k raw rows)
- [ ] Measure generate time for the whole month and for one department; target **< 5 min** whole month (REQUIREMENTS §7), ideally < 60 s per department (fits in one HTTP request)
- [ ] Fix hot spots: batched queries, multi-row upserts, missing indexes (`EXPLAIN ANALYZE`)
- [ ] If a department run exceeds the request timeout: generate per department in the UI, or raise Nginx `proxy_read_timeout`
- [ ] Demo with HR: 10 employees vs manual results; log every difference as **rule gap** or **manual error**

## 3. Acceptance criteria
- [ ] Timing results written in the ticket
- [ ] 10 DTRs match HR's manual computation, or each difference is explained (**A8**)

## 4. References
[[CVSU-DTR/v3/REQUIREMENTS]] §7 · [[CVSU-DTR/v3/PHASE1-MVP-1-MONTH]] §8 week 3
