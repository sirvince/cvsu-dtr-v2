---
id: BE-013
title: Import preview + unmatched IDs
type: Feature
priority: P1
status: TODO
epic: E2 Attendance import
module: attendance-import / employees
week: 2
day: 2026-10-14
estimate_h: 2
depends_on: [BE-012]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-013 — Import preview + unmatched IDs

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-database`

> [!info] v3 changes (2026-10-05)
> To make room for advance processing, the staged-rows preview (`/preview?page`) and the cross-batch `GET /biometric-ids/unmatched` move to **Phase 1B**. The per-batch unmatched list (needed for A4) stays. Estimate **3 → 2 h**.

## 1. Background & problem
Before committing, HR must see how many punches are **new vs already imported**, and which biometric IDs aren't linked to any employee, so they can fix the mapping (acceptance **A3, A4**).

## 2. Objective
Preview data for a validated batch, and an unmatched-ID list HR can resolve by linking IDs to employees.

## 3. Scope
**In**
- [ ] Extend the batch summary: `new_punches` vs `duplicate_punches` (staging rows that already exist in `raw_attendance_records` on `(device_id, biometric_identifier, punched_at)`), `unmatched_identifiers`
- [ ] `GET /attendance-imports/:id/unmatched` → `[{ biometricIdentifier, punches, firstDate, lastDate, nameInFile? }]` — identifiers in staging with no mapping valid on their dates
- [ ] Linking uses BE-005 `POST /employees/:id/biometric-ids`; the preview recalculates on the next GET
- [ ] Index support: `idx_raw_ident_date`

**Out**
- Auto-matching by name (risky; maybe 1B as a suggestion only)
- *v3:* `GET /attendance-imports/:id/preview?page` (staged rows) and `GET /biometric-ids/unmatched` via `v_unmatched_identifiers` (1B). The view itself is still created in BE-014.

## 4. Acceptance criteria
- [ ] Preview counts add up: `valid_rows = new + duplicate`
- [ ] After linking all unmatched IDs, `unmatched = 0` (**A4**)
- [ ] Linking never modifies raw or staged punches
- [ ] Preview of a 50k-row batch responds in < 2 s

## 5. Tests
Int: new/duplicate counting against existing raw rows; unmatched with dated mappings. API: link → unmatched decreases.

## 6. References
[[CVSU-DTR/v3/REQUIREMENTS]] US-01 AC2, US-02 · [[CVSU-DTR/v3/DATABASE-MAPPING]] §6 · [[CVSU-DTR/v3/UI_DESIGN]] §6.5
