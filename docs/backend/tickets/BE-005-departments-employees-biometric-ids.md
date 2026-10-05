---
id: BE-005
title: Departments, employees, biometric ID mapping
type: Feature
priority: P1
status: TODO
epic: E1 Foundation & setup data
module: departments / employees
week: 1
day: 2026-10-07
estimate_h: 4
depends_on: [BE-004]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-005 — Departments, employees, biometric ID mapping

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-database`

## 1. Background & problem
Raw punches only carry a biometric enrolment number. Processing needs a dated mapping `device + identifier → employee` (ADR-03), and HR needs to maintain the employee master list.

## 2. Objective
CRUD for departments and employees, and dated biometric ID mappings with overlap protection.

## 3. Scope
**In**
- [ ] `GET/POST /departments`, `GET/PATCH /departments/:id`, deactivate
- [ ] `GET /employees` (`?q`, `departmentId`, `status`, pagination, whitelisted sort), `POST`, `GET/PATCH /employees/:id`, `POST /employees/:id/deactivate`
- [ ] `GET/POST /employees/:id/biometric-ids`, `PATCH …/:mappingId` (set `valid_to`)
- [ ] `EmployeesService.resolveByBiometric(deviceId, identifier, date)` and `.listActive(periodRange, departmentId?)` (public service for later modules)
- [ ] Seed device `MAIN-01` (Phase 1 has no device UI)
- [ ] Audit create/update/deactivate

**Out**
- Employee CSV import (BE-006), user accounts for employees (1B)

## 4. Acceptance criteria
- [ ] Duplicate `employee_number` → `409 EMPLOYEE_NUMBER_EXISTS`
- [ ] Overlapping mapping → `409 BIOMETRIC_MAPPING_OVERLAP`; closing the old one (`valid_to`) then adding a new one works
- [ ] Employees are deactivated, never deleted
- [ ] `limit > 100` rejected; unknown sort field rejected
- [ ] `resolveByBiometric` respects `valid_from/valid_to`

## 5. Tests
API: CRUD + error codes + 401 without token. Int: `resolveByBiometric` with dated ranges.

## 6. References
[[CVSU-DTR/v3/MODULES]] §4 employees · [[CVSU-DTR/v3/API-DESIGN]] §5.3 · [[CVSU-DTR/v3/DATABASE-MAPPING]] §5
