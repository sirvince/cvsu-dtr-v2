---
id: BE-003
title: DB foundation, roles, migrations 0001–0002, audit
type: Task
priority: P0
status: TODO
epic: E1 Foundation & setup data
module: database / audit
week: 1
day: 2026-10-06
estimate_h: 4
depends_on: [BE-002]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-003 — DB foundation, roles, migrations 0001–0002, audit

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skill: `dtr-database`

## 1. Background & problem
Phase 1 must use the **v3 tables** so later phases only add. Append-only guarantees depend on DB roles existing from the first migration. Phase 1 also audits imports, generation, finalize and downloads, so `audit_logs` is needed in week 1.

## 2. Objective
TypeORM wired with migrations only, two DB roles, the first two migrations, and a working `AuditService`.

## 3. Scope
**In**
- [ ] TypeORM `DataSource` (`synchronize: false`), CLI scripts `migration:generate|run|revert`; session `TimeZone=UTC`; `pg` type parser keeps `date` (OID 1082) as string
- [ ] Bootstrap SQL (infra): roles `migrator` (DDL owner) and `app_user` (DML)
- [ ] `0001_init_users_auth`: extensions (`pgcrypto`, `citext`, `btree_gist`), `users`, `user_roles`, `refresh_tokens`, `password_reset_tokens`, **`audit_logs`** (+ `REVOKE UPDATE, DELETE, TRUNCATE … FROM app_user`) — per BE-000 D9
- [ ] `0002_org_and_devices`: `departments`, `employees`, `biometric_devices`, `employee_biometric_ids` (🔒 EXCLUDE gist on device+identifier+daterange), `user_department_scopes`
- [ ] Grants to `app_user` for each table
- [ ] `audit` module: `AuditService.record(tx, { actor, action, entityType, entityId, before?, after?, reason?, requestId, ip, userAgent })`

**Out**
- Remaining tables (added by their tickets: 0003 BE-008, 0004 BE-007, 0005 BE-010/012/014, 0006 BE-016, 0007 BE-019)

## 4. Acceptance criteria
- [ ] `yarn workspace @cvsu-dtr/api migration:run` on an empty DB creates all tables; `revert` removes them
- [ ] App connects as `app_user`; migrations run as `migrator`
- [ ] `UPDATE audit_logs` as `app_user` → permission denied
- [ ] Overlapping biometric mapping for the same device + ID → `23P01`, mapped to `409 BIOMETRIC_MAPPING_OVERLAP`

## 5. Tests
Testcontainers (`*.int-spec.ts`): migrations up/down, audit append-only grant, biometric EXCLUDE constraint.

## 6. References
[[CVSU-DTR/v3/DATABASE-MAPPING]] §1–§5, §10, §13
