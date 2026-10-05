---
id: BE-012
title: Import upload + validate (staging, errors, guards)
type: Feature
priority: P0
status: TODO
epic: E2 Attendance import
module: attendance-import
week: 2
day: 2026-10-13
estimate_h: 5
depends_on: [BE-010, BE-011]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-012 — Import upload + validate

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-security`, `dtr-database`

## 1. Background & problem
HR uploads an export; the system must read and check it **before** anything touches the raw punch table, and reject dangerous files (zip bombs, macros, wrong types) — acceptance **A3, A6**.

## 2. Objective
`POST /attendance-imports` stores the file, parses it into staging, records row errors, and returns a validation summary (synchronous in Phase 1, per BE-000 D4).

## 3. Scope
**In**
- [ ] Migration (`0005_import_and_raw`): `attendance_import_batches`, `attendance_import_staging`, `attendance_import_errors`
- [ ] `POST /attendance-imports` multipart `file` (+ `deviceId`, default `MAIN-01`) → `201 { id, status: VALIDATED | REJECTED, summary }`
- [ ] Upload guards: ≤ 20 MB (`413 IMPORT_TOO_LARGE`), extension whitelist `.xlsx/.csv`, magic bytes (`PK\x03\x04` for xlsx), reject `.xlsm`/macros, zip-bomb guard (uncompressed size + entry count), ≤ 200k rows → else `IMPORT_INVALID_FORMAT`
- [ ] Row specs: RequiredColumns, NonEmptyIdentifier, ValidDateTime, NotInFuture (`Clock`), WithinSanityRange(±400 days), KnownDevice
- [ ] Batch status machine: `UPLOADED → VALIDATING → VALIDATED | REJECTED`, `FAILED` on system error
- [ ] Store counts: `total_rows, valid_rows, invalid_rows`, `detected_date_from/to`, `file_sha256`; warn `IMPORT_DUPLICATE_FILE_WARNING` if the hash was seen (warning only)
- [ ] Staging insert in bulk (multi-row / COPY); **no transaction held during parsing**
- [ ] `GET /attendance-imports` (history), `GET /attendance-imports/:id`, `GET /attendance-imports/:id/errors?errorCode&page`
- [ ] Audit `ATTENDANCE_IMPORT_UPLOADED`

**Out**
- Preview counts new/duplicate/unmatched (BE-013), commit (BE-014)

## 4. Acceptance criteria
- [ ] A real October export → `VALIDATED`, correct date range and row counts (**A3**)
- [ ] `.pdf` renamed to `.xlsx`, corrupted xlsx, `.xlsm` → `REJECTED` / `IMPORT_INVALID_FORMAT` with a clear message (**A6**)
- [ ] Zip bomb fixture is rejected before full decompression
- [ ] Invalid rows are kept with row number, raw values and error code; nothing silently dropped
- [ ] Same file uploaded twice → second shows the duplicate-file warning, but is still allowed

## 5. Tests
API + parser fixtures for each criterion. Int: staging bulk insert.

## 6. References
[[CVSU-DTR/v3/API-DESIGN]] §5.6, §8 · [[CVSU-DTR/v3/REQUIREMENTS]] US-01 · [[CVSU-DTR/v3/BUSINESS-RULES]] §9 (import batch)
