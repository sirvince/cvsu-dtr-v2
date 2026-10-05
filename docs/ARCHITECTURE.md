---
title: CVSU DTR — Architecture
version: 2.0
status: draft
updated: 2026-09-29
---

# CVSU DTR — Architecture

Related: [[CVSU-DTR/v3/README|README]] · [[CVSU-DTR/v3/MODULES|MODULES]] · [[CVSU-DTR/v3/STACK|STACK]] · [[CVSU-DTR/v3/SECURITY-PRIVACY|SECURITY-PRIVACY]]

---

## 1. Overview

The system is a **modular monolith**: one NestJS API plus a React SPA, backed by PostgreSQL. It turns biometric exports into validated, printable **CSC Form 48** DTRs.

> **Key principle:** The biometric device is the source of *evidence*. The DTR system owns *interpretation*: schedules, rules, exceptions and the DTR. Interpretation can always be recomputed from evidence.

## 2. Architectural goals
1. Correct, explainable calculations: every number can be traced to punches, schedule, exceptions and rule version.
2. Raw evidence is never altered.
3. HR stays in control: validate, finalize, reopen, with segregation of duties.
4. Simple to run: one API, one database, optional worker.
5. Ready for direct device sync without changing the domain.

## 3. Context

```
             ┌───────────────┐   XLSX/CSV export (Phase 1)   ┌─────────────────────┐
             │ ZKTeco MB20   │ ─────────────────────────────▶│                     │
             │ biometric(s)  │   ADMS/API push (Phase 3)     │    CVSU DTR System   │
             └───────────────┘ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ▶ │                     │
                                                             │  API + Web + Worker  │
  Employees ──(browser/mobile)──────────────────────────────▶│                     │
  Dept Heads ───────────────────────────────────────────────▶│                     │──▶ PDF (CSC Form 48)
  HR Staff / HR Admin ──────────────────────────────────────▶│                     │      │ print, wet-sign
  System Admin ─────────────────────────────────────────────▶│                     │      ▼
                                                             └─────────────────────┘   HR (physical copy)
```

## 4. Containers

```
Browser ──HTTPS──▶ Nginx ──┬── /        → static React build
                           └── /api/v1  → NestJS API ──┬── PostgreSQL (system of record + pg-boss job tables)
                                                       ├── File storage (local volume → S3-compatible later)
                                                       └── Worker process (same codebase, `WORKER=true`)
                                                             ├── processing jobs
                                                             ├── bulk DTR generation / PDF rendering (headless Chromium)
                                                             └── report exports
```

- **API** and **Worker** are the same NestJS codebase started in two modes. In Phase 1 the worker can be disabled, and jobs then run inline.
- **Redis** is *not* required in Phase 1 (see [[CVSU-DTR/v3/STACK#6. Background jobs]]).

## 5. Layers (inside each module)

```
Controller (HTTP, DTO validation, auth guards)
   ↓
Application (use cases: orchestration, transactions, authorization-by-scope)
   ↓
Domain (pure calculators, rules, state machines; no Nest, no TypeORM)
   ↓
Ports (repository / storage / parser / generator interfaces)
   ↓
Infrastructure (TypeORM repos, ExcelJS parser, Chromium PDF, disk/S3 storage)
```

Rule: **domain code imports nothing from NestJS, TypeORM, Express, ExcelJS or Puppeteer.** This keeps the calculators unit-testable with the table in [[CVSU-DTR/v3/BUSINESS-RULES#10. Reference test cases]].

## 6. Core data flow

```
 Export file
    │  upload (HR_STAFF)
    ▼
 Import batch ── validate ──▶ errors (row-level) ── review ──▶ commit
    │                                                          │
    │                                   INSERT … ON CONFLICT DO NOTHING
    ▼                                                          ▼
                                            raw_attendance_records (append-only)
                                                               │
   employee_biometric_ids ─┐                                   │
   approved schedules ─────┤                                   │
   approved exceptions ────┼──▶ Process DTR period (job) ◀─────┘
   calendar events ────────┤          │
   rule set version ───────┘          ▼
                               processed_attendance (derived, rebuildable)
                                      │
                                      ▼
                         Generate DTRs (DRAFT) → review → validate → finalize
                                      │                               │
                                      ▼                               ▼
                               dtr_items (live)              dtr_items snapshot + PDF + SHA-256
                                                                      │
                                                     download → print → sign → receive
```

## 7. Key workflows

### 7.1 Monthly HR cycle
1. HR_ADMIN opens the DTR period (e.g., "October 2026").
2. HR_STAFF uploads exports (any number, overlaps OK) → validate → commit.
3. HR_STAFF resolves unmatched biometric IDs.
4. HR_STAFF runs **Process period**, then reviews the "Needs Attention" queue (blocking flags, no-schedule employees).
5. HR records or approves exceptions (maker-checker) and reprocesses.
6. HR_STAFF **generates DTRs** (bulk) → DRAFT.
7. Employees review and confirm (→ FOR_REVIEW); HR bulk-moves the rest at the deadline.
8. HR_STAFF validates → HR_ADMIN finalizes (PDF generated).
9. Employees download, print and sign; the In-Charge signs; the physical copy goes to HR → RECEIVED.
10. HR_ADMIN closes the period.

### 7.2 Semester setup
Academic year → semester → DTR periods (monthly) → schedule templates → employees submit schedules → Department Head/HR approves.

Full state machines: [[CVSU-DTR/v3/BUSINESS-RULES#7. DTR lifecycle]] and §9 there.

## 8. Extensibility: attendance sources

```
AttendanceSource (port)
 ├── FileImportSource          Phase 1 — ExcelJS/csv-parse parsers via ParserRegistry
 └── DeviceSyncSource          Phase 3 — ADMS push endpoint or vendor SDK poller
          │
          ▼
  NormalizedPunch { deviceCode, biometricIdentifier, punchedAt(Asia/Manila), rawPayload }
          │
          ▼
  AttendanceService.ingest(punches[])  → same dedup + append-only store
```

The processing and DTR modules never know where a punch came from.

## 9. Cross-cutting concerns

| Concern | Approach |
|---|---|
| AuthN | JWT access token (15 min) + rotating refresh token (httpOnly cookie) — see SECURITY-PRIVACY |
| AuthZ | Role guard + **scope guard** (own records / department scope) in the application layer |
| Validation | DTO (class-validator) → domain rules → DB constraints |
| Transactions | Use-case level; never hold a transaction during file parsing or PDF rendering |
| Audit | `AuditService.record()` in the same transaction as the state change |
| Errors | Typed domain errors → mapped to HTTP by a global filter (API-DESIGN §9) |
| Logging | Pino JSON logs with request ID; no personal data in logs beyond IDs |
| Config | `@nestjs/config` + schema validation at startup; no `process.env` in modules |
| Time | All "business date" logic in `Asia/Manila` through a single `Clock`/`BusinessCalendar` service |

## 10. Deployment (Phase 1)

A single Linux VM (on-prem university server or VPS), Docker Compose:

| Service | Notes |
|---|---|
| `nginx` | TLS (Let's Encrypt or university cert), static files, `/api` proxy, request size limit 25 MB |
| `api` | NestJS, 2 replicas optional |
| `worker` | Same image, `WORKER=true`, includes Chromium |
| `postgres` | PostgreSQL 16+/17, volume, nightly `pg_dump` + WAL archiving optional |
| `backup` | Cron container that ships encrypted dumps off-server |

Shared web hosting is **not** suitable, because it can't run Docker, long-running Node processes or Chromium.

## 11. Quality attributes → tactics

| Attribute | Tactic |
|---|---|
| Correctness | Pure calculators + HR-signed test table + versioned rule sets |
| Auditability | Append-only raw data, status history, audit log, PDF hash |
| Performance | Batch inserts (COPY/multi-row), per-period processing in chunks of employees, indexes on `(biometric_identifier, punched_at)` |
| Security | RBAC + scopes, ownership checks, upload validation, rate limiting |
| Operability | Health checks, job dashboard, structured logs, restore-tested backups |
| Evolvability | Ports/adapters at sources, storage, generator; modules with explicit public services |
