---
id: BE-011
title: MB20 XLSX/CSV parsers + ParserRegistry
type: Feature
priority: P0
status: TODO
epic: E2 Attendance import
module: attendance-import
week: 2
day: 2026-10-12
estimate_h: 5
depends_on: [BE-001]
blocked_by: [P1 real MB20 exports]
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-011 — MB20 XLSX/CSV parsers + ParserRegistry

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-security`, `dtr-testing`

> [!danger] Blocked by P1
> Needs 2–3 **real** ZKTeco MB20 export files. If they haven't arrived by Fri Oct 9, build the CSV parser against a guessed layout (`ID, Name, Date/Time, State, Device`) and adapt the column map when the files arrive.

## 1. Background & problem
The column layout of the MB20 export is the parser contract. Device times have **no timezone** and must be read as Asia/Manila. The npm `xlsx` package has known CVEs (ADR-17).

## 2. Objective
Streaming parsers that turn an export into `NormalizedRow { rowNumber, biometricIdentifier, punchedAt (UTC instant), punchDate (Manila date), rawState, rawPayload }` or a row error.

## 3. Scope
**In**
- [ ] `AttendanceParser` port + `ParserRegistry.detect(file)` (by extension + magic bytes + header row)
- [ ] `Mb20XlsxParser` (ExcelJS **streaming** reader, one sheet / configured sheet name) and `Mb20CsvParser` (`csv-parse` streaming)
- [ ] Column map configurable per parser version (`parser_name`, `parser_version` stored on the batch)
- [ ] Date/time parsing for the formats seen in P1 files (text and Excel serial dates); seconds kept in `punchedAt`
- [ ] Row errors: `MISSING_COLUMN` (file-level), `EMPTY_IDENTIFIER`, `INVALID_DATE`, `INVALID_TIME`, `OUT_OF_RANGE`
- [ ] Anonymize the P1 files into `apps/api/test/fixtures/mb20/` (replace names; keep IDs/times structure)

**Out**
- `.xls` legacy format (decide after seeing P1), device sync (Phase 3)

## 4. Acceptance criteria
- [ ] All P1 sample files parse with 0 unexpected errors; row counts match the file
- [ ] `2026-10-05 08:15:00` (device local) → `punchedAt = 2026-10-05T00:15:00Z`, `punchDate = 2026-10-05`
- [ ] A punch at device time `00:30` stays on its own Manila date (no UTC shift)
- [ ] Missing required column → file-level `IMPORT_MISSING_COLUMNS`
- [ ] Parsing a 200k-row file does not load it all into memory
- [ ] No dependency on the npm `xlsx` package

## 5. Tests
Jest + fixtures: each P1 file, malformed rows, missing column, Excel serial dates, midnight edge, large file.

## 6. References
[[CVSU-DTR/v3/DESIGN-PATTERNS]] §6 · [[CVSU-DTR/v3/STACK]] §5 · [[CVSU-DTR/v3/DATABASE-MAPPING]] §3
