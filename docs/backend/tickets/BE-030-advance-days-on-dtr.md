---
id: BE-030
title: Advance days on the DTR (items, totals, HR credit view, Form 48)
type: Feature
priority: P1
status: TODO
epic: E5 Advance processing
module: dtr / advance-credits
week: 4
day: 2026-10-26
estimate_h: 4
depends_on: [BE-020, BE-029]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket, v3]
---

# BE-030 — Advance days on the DTR (items, totals, HR credit view, Form 48)

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-security`

> [!warning] New in v3
> HR decision C-03 / D-HR-05: advance days **print like normal days**, with time in/out from the schedule and a blank remark (O-4 default). The employee signs times the device never recorded, so the system must keep the distinction everywhere **except** the printed form. See the risk "advance days printed like real attendance" in [[CVSU-DTR/v3/DEVELOPMENT-PHASES|DEVELOPMENT-PHASES]] §10.
> Cut list ③: the HR credit list endpoint can be cut. The DTR item mapping and totals can't.

## 1. Background & problem
BE-029 writes `ADVANCE` processed days and `advance_credits`. The DTR builder, the DTR read API and the PDF must then show these days correctly:
- the printed form shows schedule times;
- HR screens show that the day is an **advance credit**, its status, and its history.

## 2. Objective
Map advance days into `dtr_items` and DTR totals, expose them in the DTR API with their basis and credit status, and give HR a list of the period's credits with their history.

## 3. Scope
**In**
- [ ] `GenerateDtrsUseCase` (BE-019): an `ADVANCE` day becomes a `dtr_items` row:
  - slots = AM/PM group start/end from the schedule
  - `day_status = ADVANCE_CREDIT`, `slot_sources = ADVANCE`
  - undertime 0, remarks blank (O-4 ⚠)
- [ ] Totals: `dtrs.advance_credit_minutes` = Σ `credited_minutes` of the DTR's `ADVANCED` credits. How advance days count in `days_present` etc. follows BUSINESS-RULES §5.10 / §12 ⚠.
- [ ] `GET /dtrs/:id` (BE-020): items carry `attendanceBasis` and `advanceCredit { id, status, creditedMinutes } | null`. The header carries `processedUntil`, `advanceCreditMinutes` and `priorPeriodAdjustmentMinutes` (always 0 until BE-032).
- [ ] `GET /dtrs?…`: an `advanceDays` count column
- [ ] `GET /dtr-periods/:id/advance-credits?status&departmentId&page` and `GET /advance-credits/:id/events` (history, oldest first) ⚠ paths per [[CVSU-DTR/v3/API-DESIGN|API-DESIGN]]
- [ ] Form 48 data mapping (BE-023): an advance day prints exactly like a normal day using its schedule times. Optional footer note "includes advance credit" behind the template flag `show_advance_footer_note`, **default off** until HR confirms in writing (O-4) ⚠.
- [ ] Audit: reading credits is not audited in Phase 1. Everything that changes a credit is audited in BE-029 / BE-031.

**Out**
- Prior-period adjustment lines (BE-032)
- Employee-facing views (1B)

## 4. Acceptance criteria
- [ ] **A01** end to end: the DTR detail shows the credited Monday with 07:00 / 12:00 / 14:00 / 19:00, `attendanceBasis = ADVANCE`, credit `ADVANCED`. The rendered PDF shows the same times and a blank remark.
- [ ] `advance_credit_minutes` on the DTR equals the sum of its open credits
- [ ] The credit history endpoint lists `CREATED` (and `CANCELLED` after a re-run) in order
- [ ] The PDF has no "advance" wording while `show_advance_footer_note = false`

## 5. Tests
- Unit: item mapping for an advance day, totals.
- API: detail shape, credit list filters, history order.
- Int: render the A01 DTR and check the bound data.

## 6. References
[[CVSU-DTR/v3/BUSINESS-RULES]] §5.10, §12 · [[CVSU-DTR/v3/DATABASE-MAPPING]] §8–§9 · [[CVSU-DTR/v3/UI_DESIGN]] (DTR detail) · [[CVSU-DTR/v3/README]] ADR-22, ADR-26 · [[CVSU-DTR/HR-Requirements-Analysis]] D-HR-05, §8.2, §8.7 O-4
