---
id: BE-028
title: HR acceptance A1–A12 + runbooks + handover
type: Task
priority: P0
status: TODO
epic: E4 PDF, finalize, deploy
module: all
week: 4
day: 2026-10-30
estimate_h: 3
depends_on: [BE-027]
blocked_by: [HR availability]
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-028 — HR acceptance + runbooks + handover

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skill: `dtr-testing`

## 1. Objective
🎯 **Deadline Fri Oct 30, 2026.** HR completes the full flow on the real server with real data and signs the acceptance sheet.

## 2. Acceptance run (with HR)

| # | Test | Backend tickets | Result |
|---|---|---|---|
| A1 | 5 wrong passwords lock the account | BE-004 | ☐ |
| A2 | Employee CSV with 2 bad rows → good rows saved, 2 errors | BE-006 | ☐ |
| A3 | Real MB20 October export → correct range, counts, unmatched | BE-011–013 | ☐ |
| A4 | Link unmatched IDs, commit → unmatched = 0 | BE-013–014 | ☐ |
| A5 | Same file again → 0 new | BE-014 | ☐ |
| A6 | Non-Excel / corrupted file rejected | BE-012 | ☐ |
| A7 | Generate one department → 1 DTR each; no-schedule flagged | BE-019 | ☐ |
| A8 | 10 DTRs match manual computation (or explained) | BE-018, BE-022 | ☐ |
| A9 | Holiday shown as holiday, not absent | BE-008, BE-018 | ☐ |
| A10 | Finalized DTR can't be regenerated; unlock needs reason | BE-024 | ☐ |
| A11 | PDF + department ZIP open; PDF matches Form 48 printed | BE-023, 025, 026 | ☐ |
| A12 | Restart: data intact, today's backup exists | BE-027 | ☐ |

## 3. Scope
- [ ] Fix blockers found during the run (only Critical/High)
- [ ] Runbooks (short): *import failed*, *PDF rendering failed*, *restore from backup*, *unlock a finalized DTR*, *rotate secrets*
- [ ] One-page HR user guide (with printer settings from BE-026)
- [ ] Release tag `v0.1.0`, changelog, list of known issues → Phase 1B backlog
- [ ] Update [[CVSU-DTR/v3/README|README]] changelog + this roadmap's statuses

## 4. Acceptance criteria
- [ ] A1–A12 passed (or each failure has an agreed workaround and date)
- [ ] Signed acceptance sheet from the HR focal person

## 5. References
[[CVSU-DTR/v3/PHASE1-MVP-1-MONTH]] §10 · [[CVSU-DTR/v3/SECURITY-PRIVACY]] §8–§9
