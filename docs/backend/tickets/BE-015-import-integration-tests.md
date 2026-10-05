---
id: BE-015
title: Import integration tests (dedup, overlap, bad files)
type: Task
priority: P0
status: TODO
epic: E2 Attendance import
module: tests
week: 2
day: 2026-10-16
estimate_h: 3
depends_on: [BE-013, BE-014]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket, never-cut]
---

# BE-015 — Import integration tests + week-2 demo

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skill: `dtr-testing`

## 1. Objective
Prove the whole import flow end-to-end through the API with real (anonymized) files, and run the **Fri Oct 16 demo**: import 2 overlapping real files; the 2nd adds only new punches.

## 2. Scope
**In**
- [ ] Supertest scenario: upload file A → commit → upload A again → `0 new` → upload overlapping file B → only new punches → totals in DB equal the union of A and B
- [ ] Bad files: non-Excel, corrupted, zip bomb, missing column, oversized → correct error codes
- [ ] Unmatched flow: upload → unmatched listed → link → unmatched = 0 → commit
- [ ] Performance: 50k-row file validates in < 60 s (REQUIREMENTS §7)
- [ ] Fix bugs found; update the demo script in the README

## 3. Acceptance criteria
- [ ] All scenarios green in CI (Testcontainers)
- [ ] Acceptance **A3, A4, A5, A6** covered by automated tests
- [ ] Demo done with HR, notes recorded

## 4. References
[[CVSU-DTR/v3/PHASE1-MVP-1-MONTH]] §8 week 2, §10 · [[CVSU-DTR/v3/DESIGN-PATTERNS]] §10
