---
id: BE-036
title: Make-up class processing (make-up block, outcome, reversal carry-forward)
type: Feature
priority: P1
status: TODO
epic: E7 Phase 1B approvals & balances
module: attendance (processing / exceptions)
week:
day:
estimate_h: 10
depends_on: [BE-031, BE-032, BE-033]
blocked_by: []
phase: 1B
tags: [cvsu-dtr, backend, ticket, v3, placeholder]
---

# BE-036 — Make-up class processing (make-up block, outcome, reversal carry-forward)

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-testing`

> [!note] Phase 1B placeholder
> Phase 1 stop-gap (BE-021): HR records a paper-approved make-up letter. The original date is excused and `makeup_class_details` is stored with `outcome = PENDING`. **HR checks the make-up date's punches by hand** until this ticket ships. This ticket then sets the outcomes of those stored make-ups retroactively, and any reversal is carried forward (BE-032) ⚠.
> Open items O-2 (approval levels) and O-7 (partial attendance) use their proposed defaults.

## 1. Background & problem
HR answers Q-M1 to Q-M3 and C-09 (D-HR-20, D-HR-23 to D-HR-25):
- a letter is required;
- the original date is ABSENT until the letter is approved;
- the make-up date **requires punches**, measured against the make-up times;
- the make-up may fall in a later period;
- if it isn't attended, the excuse is reversed and carried forward (ADR-31).

Rules: [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] §8.

## 2. Objective
Processing adds the make-up time as an extra expected block on the make-up date. Once an import covers that date, the outcome is set automatically (same trigger as BE-031), and an unattended make-up produces a carried-forward reversal.

## 3. Scope
**In**
- [ ] Make-up block on `makeup_date`. It overrides REST_DAY for that block and uses `attendance_basis = ACTUAL` (D-HR-23).
- [ ] Outcome `ATTENDED` / `PARTIAL` / `NOT_ATTENDED`, set on import commit (subscribe to `AttendanceImportCommitted` like BE-031)
- [ ] `NOT_ATTENDED` → `reversal_minutes` posted as a `MAKEUP_CLASS` row in `carry_forward_adjustments` (BE-032), applied to the next open DTR. If the original date's DTR is still DRAFT, the day is just recalculated (ADR-25).
- [ ] Letter approved after finalization → a positive `MAKEUP_CLASS` row in the next open DTR (D-HR-25, D-HR-22)

## 4. Acceptance criteria
- [ ] **M01–M07** pass. ⚠ Fix the fixture dates: Sept 5, 2026 is a **Saturday**, not a Friday.
- [ ] **M04**: a make-up in a later period is evaluated in that period

## 5. References
[[CVSU-DTR/v3/BUSINESS-RULES]] §8, §12 · [[CVSU-DTR/v3/README]] ADR-25, ADR-31 · [[CVSU-DTR/HR-Requirements-Analysis]] D-HR-20, D-HR-23 to D-HR-25, §8.6 M01–M07, §8.7 O-2, O-7
