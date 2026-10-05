---
id: BE-006
title: Employee CSV import
type: Feature
priority: P2
status: TODO
epic: E1 Foundation & setup data
module: employees
week:
day:
estimate_h: 3
depends_on: [BE-005]
blocked_by: []
phase: 1B
tags: [cvsu-dtr, backend, ticket, cut-list, moved-to-1b]
---

# BE-006 — Employee CSV import

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-security`

> [!info] v3 changes (2026-10-05): **moved to Phase 1B**
> This was cut list #3 in v2. It is cut up front in v3 to make room for advance processing (see [[CVSU-DTR/v3/PHASE1-MVP-1-MONTH|PHASE1-MVP]] §0).
> In Phase 1 the P3 employee list is loaded with a **one-off loader script** (`seed:employees <csv>`, BE-009). That script uses the same row rules, but has no API and no upload screen.
> Acceptance **A2** moves to 1B with this ticket. Estimate unchanged; schedule it at 1B planning.

## 1. Background & problem
~1,000 employees can't be typed in by hand. HR has a list (P3) with employee number, name, department and biometric ID.

## 2. Objective
Upload a CSV, validate every row, save the good rows, and report the bad ones with row numbers (acceptance **A2**).

## 3. Scope
**In**
- [ ] `POST /employees/import` (multipart CSV, ≤ 5 MB) — synchronous in Phase 1
- [ ] Columns (confirm against P3): `employee_number, last_name, first_name, middle_name, suffix, department_code, category, employment_type, biometric_identifier`
- [ ] Row rules: required fields, known department code, valid enums, duplicate employee number (in file and in DB), mapping overlap
- [ ] Upsert by `employee_number` (update names/department if it exists) + create biometric mapping on device `MAIN-01` (`valid_from` = import date)
- [ ] Response: `{ total, created, updated, failed, errors: [{ row, field, code, message }] }`
- [ ] Whole file in one transaction **for the valid rows**; invalid rows are reported, not saved
- [ ] Audit `EMPLOYEE_IMPORT`

**Out**
- Background job (1B), XLSX employee files

## 4. Acceptance criteria
- [ ] CSV with 2 bad rows → good rows saved, exactly 2 errors with row numbers (**A2**)
- [ ] Re-importing the same file → 0 created, N updated (or unchanged), no duplicates
- [ ] Non-CSV / oversized file rejected with a clear error code

## 5. Tests
Parser unit tests with small fixture CSVs; API test for A2.

## 6. References
[[CVSU-DTR/v3/PHASE1-MVP-1-MONTH]] §2, §10 · [[CVSU-DTR/v3/MODULES]] §4 employees
