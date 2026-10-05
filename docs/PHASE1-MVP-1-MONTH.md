---
title: CVSU DTR — Phase 1 MVP (1-month full-stack build)
version: 2.1
status: draft
updated: 2026-09-29
start: 2026-10-05
deadline: 2026-10-30
---

# Phase 1 MVP — 1-Month Full-Stack Build

Visual flow: [[CVSU-DTR/v3/PHASE1-E2E-FLOW.canvas|PHASE1-E2E-FLOW (canvas)]] · Full design: [[CVSU-DTR/v3/README|v3 README]] · Rules: [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]]

> [!goal] Phase 1 in one sentence
> **HR exports attendance from the device → imports it into the system → generates the DTR → downloads the CSC Form 48 PDF.**
> Deadline: **Friday, October 30, 2026** (4 weeks, 20 working days).

---

## 1. Assumptions

| Item | Assumption |
|---|---|
| Team | 1–2 full-stack developers. The plan below is sized for **1 focused developer**; with 2, split backend and frontend per week. |
| Users | **HR only** (1–3 HR accounts). No employee login in Phase 1. |
| Stack | Same as [[CVSU-DTR/v3/STACK\|STACK]]: Yarn 4 monorepo, NestJS + TypeORM + PostgreSQL, React + Vite + Tailwind, Puppeteer for the PDF. **No Redis, no job queue**; everything runs synchronously. |
| Data | One biometric device (MB20), one campus, up to ~1,000 employees |
| Design | Uses the **v3 table names and rules**, so Phase 1 grows into the full system without a rewrite |

### Must be ready before Oct 5 (prep: Sep 30 – Oct 2)
| # | Item | Why |
|---|---|---|
| P1 | **2–3 real MB20 export files** (XLSX/CSV) | Needed to write the parser in week 2 |
| P2 | **Official DTR template** (CSC Form 48 as CvSU uses it) + one filled sample | Needed for the PDF in week 4 |
| P3 | **Employee list** with employee number, name, department and biometric ID | Initial data load in week 1 |
| P4 | HR answers to **Q1–Q5** of BUSINESS-RULES §11 (office hours, grace period, lunch punches, undertime column, half-day) | Calculation in week 3 |

If P1 or P2 is missing on Oct 5, start week 1 anyway, but week 2 or week 4 is **at risk**.

---

## 2. Scope

### ✅ In Phase 1
| Area | Included |
|---|---|
| Login | HR login (email + password), logout, change password |
| Setup | Departments, employees (form + **CSV import**), biometric ID per employee, **default schedule** (08:00–12:00 / 13:00–17:00) assignable per employee or department, holidays, months (DTR periods) |
| Import | Upload XLSX/CSV → validate → preview (matched, unmatched, duplicates, errors) → map unmatched IDs → confirm → raw punches saved **without duplicates** |
| Generate | Choose month + department/all → calculate each day (AM/PM slots, late, undertime, absent, holiday, missing punch) → DTR (DRAFT); regenerate anytime while DRAFT |
| Review | DTR list per month, Form 48 preview per employee, flags ("missing punch", "no schedule") |
| Day remarks *(Should)* | HR marks a day as Leave / OB / Holiday with a remark; this excuses the day on regenerate |
| Finalize | Lock a DTR (`DRAFT → FINALIZED`); unlock by HR with a reason |
| Download | PDF per employee; **ZIP or merged PDF** per department |
| Safety | Raw punches append-only, audit log of imports/generation/downloads, daily DB backup |

### ❌ Not in Phase 1 (moved to later, see §9)
Employee portal and self-service · schedule submission/approval · exception approval workflow (maker-checker) · the multi-step review → validate → finalize → submit → receive cycle · Department Head role · reports · email notifications · background jobs / Redis · multiple devices/campuses · direct device sync.

---

## 3. End-to-end flow → screen → API → data

| # | Step | Who | Screen | API | Tables | Week |
|---|---|---|---|---|---|---|
| 1 | Log in | HR | `/login` | `POST /auth/login` | `users` | 1 |
| 2 | Set up employees, biometric IDs, schedules, holidays | HR | `/employees`, `/employees/import`, `/schedules`, `/holidays` | `/employees`, `/employees/import`, `/employees/:id/biometric-ids`, `/schedules/assign`, `/calendar-events` | `employees`, `employee_biometric_ids`, `employee_schedules`, `schedule_blocks`, `calendar_events` | 1 |
| 3 | Create the month | HR | `/periods` | `POST /dtr-periods` | `dtr_periods` | 1 |
| 4 | Export from MB20 | HR (outside) | — | — | — | — |
| 5 | Upload file | HR | `/imports/new` | `POST /attendance-imports` | `stored_files`, `attendance_import_batches` | 2 |
| 6 | Read & check file | System | (spinner) | (part of upload) | `attendance_import_staging`, `attendance_import_errors` | 2 |
| 7 | Show preview | System | `/imports/:id` | `GET /attendance-imports/:id`, `/errors` | — | 2 |
| 8 | Fix unmatched IDs | HR | `/imports/:id` (Unmatched tab) | `POST /employees/:id/biometric-ids` | `employee_biometric_ids` | 2 |
| 9 | Confirm import | HR | `/imports/:id` | `POST /attendance-imports/:id/commit` | — | 2 |
| 10 | Save raw punches | System | — | (commit) | `raw_attendance_records` | 2 |
| 11 | Generate DTR | HR | `/dtrs` | `POST /dtr-periods/:id/generate-dtrs` | — | 3 |
| 12 | Calculate each day | System | — | (generate) | `processed_attendance`, `dtrs`, `dtr_items` | 3 |
| 13 | Review DTR | HR | `/dtrs`, `/dtrs/:id` | `GET /dtrs`, `GET /dtrs/:id` | — | 3 |
| 14 | Finalize (lock) | HR | `/dtrs/:id` | `POST /dtrs/:id/finalize`, `/unlock` | `dtrs` | 4 |
| 15 | Create PDF | System | — | (finalize or on download) | `dtr_documents`, `stored_files` | 4 |
| 16 | Download | HR | `/dtrs`, `/dtrs/:id` | `GET /dtrs/:id/pdf`, `POST /dtrs/download` (ZIP/merged) | `audit_logs` | 4 |
| 17 | Print & sign | Outside | — | — | — | — |

---

## 4. Screens (8)

| Screen | Contents | Primary action |
|---|---|---|
| Login | Email, password | Sign in |
| Dashboard | Current month, last import, DTR counts (draft / finalized), warnings (unmatched IDs, employees without schedule) | Go to import |
| Employees | Table + search + department filter; detail with biometric ID and schedule; CSV import | Add employee |
| Schedules & holidays | Default schedule template, assign to department/employees; holiday list per month | Assign schedule |
| Months | List of DTR periods | New month |
| Import | Upload → preview (counts, errors table, unmatched IDs with "link to employee") → confirm; history list | Confirm import |
| DTRs | Month + department filter; table (employee, days present, late, undertime, flags, status); bulk generate, bulk download | Generate DTRs |
| DTR detail | Form 48 preview (Day · AM In · AM Out · PM In · PM Out · Undertime · Remarks), totals, flags, day remark *(Should)* | Download PDF |

UI rules follow [[CVSU-DTR/v3/UI_DESIGN|UI_DESIGN]]: 12-hour times, status badges, loading/empty/error states.

---

## 5. Phase 1 API (subset of [[CVSU-DTR/v3/API-DESIGN|API-DESIGN]])

```
POST   /auth/login            POST /auth/logout        POST /auth/refresh      POST /auth/change-password
GET    /departments           POST /departments
GET    /employees             POST /employees          PATCH /employees/:id    POST /employees/import (CSV)
POST   /employees/:id/biometric-ids
GET    /schedule-templates    POST /schedules/assign   { templateId, departmentId? | employeeIds[], effectiveFrom, effectiveTo }
GET    /calendar-events       POST /calendar-events    DELETE /calendar-events/:id
GET    /dtr-periods           POST /dtr-periods
POST   /attendance-imports    (multipart: file)  → validates immediately, returns preview
GET    /attendance-imports    GET /attendance-imports/:id    GET /attendance-imports/:id/errors
GET    /attendance-imports/:id/unmatched
POST   /attendance-imports/:id/commit          POST /attendance-imports/:id/discard
POST   /dtr-periods/:id/generate-dtrs          { departmentId? }  (synchronous; regenerates DRAFT DTRs)
GET    /dtrs?dtrPeriodId&departmentId&status   GET /dtrs/:id
POST   /dtrs/:id/finalize     POST /dtrs/:id/unlock { reason }
PUT    /dtrs/:id/days/:date/remark  { type: LEAVE|OB|HOLIDAY|NOTE, text }   (Should)
GET    /dtrs/:id/pdf          POST /dtrs/download { dtrIds[], format: ZIP|MERGED }
GET    /health
```
Response and error format: API-DESIGN §1 and §9.

---

## 6. Data model (subset of [[CVSU-DTR/v3/DATABASE-MAPPING|DATABASE-MAPPING]])

Use the **same tables** as v3 so later phases only add, not rename.

| Table | Phase 1 use | Simplification |
|---|---|---|
| `users`, `user_roles` | HR accounts | Only role `HR_ADMIN` |
| `departments`, `employees` | Master data | — |
| `biometric_devices` | One seeded device `MAIN-01` | No device UI |
| `employee_biometric_ids` | ID ↔ employee | `valid_from` = hire or import date |
| `schedule_templates`, `employee_schedules`, `schedule_blocks` | Default schedule assigned by HR | Created directly as `APPROVED` (no approval flow) |
| `calendar_events` | Holidays (and suspensions) | Scope = ALL |
| `dtr_periods` | Months | Status OPEN / CLOSED |
| `stored_files` | Uploads + PDFs | Local disk |
| `attendance_import_batches`, `_staging`, `_errors` | Import | Validation runs inside the upload request |
| `raw_attendance_records` | Punches | 🔒 unique `(device_id, biometric_identifier, punched_at)` + append-only trigger |
| `attendance_rule_sets` | One seeded rule set `DEFAULT v1` | Values from HR answers P4 |
| `attendance_exceptions` | Day remarks (Leave/OB) *(Should)* | Created as `APPROVED` by HR (maker-checker comes later) |
| `processed_attendance` | Daily results | — |
| `dtrs`, `dtr_items`, `dtr_status_history`, `dtr_documents` | DTR + PDF | Status only `DRAFT`, `FINALIZED` |
| `audit_logs` | Import, commit, generate, finalize, unlock, download | No UI |

---

## 7. Calculation in Phase 1

The FIXED strategy from BUSINESS-RULES §4–§5 applies, with these limits:
- One schedule per employee (AM + PM block); no flexi-time.
- Handled: double-tap removal, AM/PM slot assignment, late, early out, undertime, absent, half-day absent, missing punch, holiday, rest day (Sat/Sun), no schedule.
- Day remarks (Leave/OB) excuse the day when that *Should* item is done.
- Test cases **T01–T10, T13, T16** (plus T09 holiday and T11/T14 if remarks are built) must pass before week 3 ends.

---

## 8. Week-by-week plan

### Week 1 — Foundation and setup data (Oct 5 – 9)
| Day | Backend | Frontend |
|---|---|---|
| Mon 5 | Yarn 4 monorepo, NestJS app, TypeORM + Postgres (Docker), config, error format, `/health` | Vite + React + Tailwind + Router + TanStack Query, app shell layout |
| Tue 6 | Migrations: users, departments, employees, devices, biometric IDs. Auth: login/refresh/logout (argon2id, JWT) | Login page, auth flow (token in memory, refresh), protected routes |
| Wed 7 | Employees CRUD + biometric IDs; departments | Employees list/detail/form |
| Thu 8 | Employee CSV import (validate rows, report errors); schedule templates + assign; seed default template | CSV import screen; schedule assignment screen |
| Fri 9 | Calendar events (holidays), DTR periods; seed script | Holidays + Months screens. **Demo:** real employee list loaded, schedule assigned, October created |

✅ **Done when:** HR can log in and prepare all employees with biometric IDs and schedules.

### Week 2 — Import attendance (Oct 12 – 16)
| Day | Backend | Frontend |
|---|---|---|
| Mon 12 | `Mb20XlsxParser` / `Mb20CsvParser` from the P1 sample files (ExcelJS streaming, csv-parse) + unit tests | Import upload page (drag & drop, progress) |
| Tue 13 | Upload endpoint: store file, parse → staging, row validation → errors, file-size and row limits | Preview page: summary counts, errors table |
| Wed 14 | Preview data: matched vs unmatched IDs, duplicates vs new (check against raw table), date range | Unmatched-IDs tab with "Link to employee" (combobox) |
| Thu 15 | Commit (`INSERT … ON CONFLICT DO NOTHING`, in chunks, one transaction), discard; append-only trigger; audit | Confirm / discard buttons, import history list |
| Fri 16 | Tests: re-upload the same and an overlapping file → **0 duplicates**; bad file → clear errors | **Demo:** import 2 real overlapping files; the 2nd adds only new punches |

✅ **Done when:** real MB20 files import correctly and duplicates are impossible.

### Week 3 — Generate DTR (Oct 19 – 23)
| Day | Backend | Frontend |
|---|---|---|
| Mon 19 | Domain: `PunchNormalizer`, `SlotAssigner` (pure TypeScript) + tests T01–T07 | DTR list page (month + department filter) |
| Tue 20 | `DayCalculator`: late / early out / undertime / status / flags; holidays, rest days; tests T08–T10, T13, T16 | DTR table columns, status badges, flags |
| Wed 21 | Generate use case: per month/department → `processed_attendance` + `dtrs` + `dtr_items` (regenerate only DRAFT) | "Generate DTRs" button + result summary |
| Thu 22 | DTR detail endpoint (items, totals, flags); *(Should)* day remark → exception → regenerate | DTR detail: Form 48 preview grid, totals, flag hints; *(Should)* remark dialog |
| Fri 23 | Performance check (1,000 employees × 1 month); fix bugs | **Demo:** HR compares 10 generated DTRs with their manual computation |

✅ **Done when:** generated DTRs match HR's manual results for the sample employees.

### Week 4 — PDF, download, deploy (Oct 26 – 30)
| Day | Backend | Frontend |
|---|---|---|
| Mon 26 | CSC Form 48 HTML/CSS template (from P2) + Puppeteer render → `dtr_documents` with SHA-256 code | "Download PDF" on DTR detail |
| Tue 27 | Finalize / unlock (reason) + status history + audit; bulk download (ZIP and merged PDF) | Finalize/unlock buttons with confirmation; bulk select + download |
| Wed 28 | **Print test** on HR's printer; fix layout (margins, fonts, 31 rows, signature lines) | Loading/empty/error states on all pages; dashboard warnings |
| Thu 29 | Deploy: Docker Compose (nginx, api, postgres) on the server, TLS, `.env`, nightly backup + a restore test | Production build, smoke test on the server |
| Fri 30 | **HR acceptance test** (§10) + fixes, short user guide, handover | 🎯 **Deadline** |

✅ **Done when:** HR completes the full flow on the real server with real data.

---

## 9. What comes after Phase 1

| Next | Adds | Owner doc |
|---|---|---|
| Phase 1B | Employee login + "My DTR", schedule submission and approval, exceptions with maker-checker, review → validate → finalize → submit → receive cycle, Department Head role, reports | [[CVSU-DTR/v3/DEVELOPMENT-PHASES\|DEVELOPMENT-PHASES]] |
| Phase 2 | Correction requests, email notifications, report exports, multi-campus, flexi-time | DEVELOPMENT-PHASES §6 |
| Phase 3 | Direct device sync, SSO, payroll integration | DEVELOPMENT-PHASES §6 |

Because Phase 1 already uses the v3 tables, raw-punch storage and calculator, these phases only **add** modules and screens.

---

## 10. Acceptance test (Oct 30, with HR)

| # | Test | Expected |
|---|---|---|
| A1 | HR logs in; a wrong password 5× locks the account | Lockout message |
| A2 | Import the employee CSV with 2 bad rows | Good rows saved; 2 errors listed |
| A3 | Upload a real MB20 export for October | Preview shows correct date range, counts and unmatched IDs |
| A4 | Link the unmatched IDs, confirm the import | Punches saved; unmatched count = 0 |
| A5 | Upload the same file again | "0 new punches, N already imported" |
| A6 | Upload a non-Excel or corrupted file | Rejected with a clear message |
| A7 | Generate DTRs for one department | One DTR per employee; employees without a schedule are flagged |
| A8 | Compare 10 DTRs with manual computation | Same late/undertime/absences (or the difference is explained) |
| A9 | A holiday in the month | Shown as holiday, not absent |
| A10 | Finalize a DTR, try to regenerate it | Blocked; unlock requires a reason |
| A11 | Download one PDF and a department ZIP | Files open; the PDF matches Form 48 when printed |
| A12 | Restart the server | Data intact; backup file exists for today |

---

## 11. Risks and cut list

| Risk | Plan |
|---|---|
| Sample files (P1) arrive late | Build the CSV parser against a guessed format first; adapt on the day files arrive |
| DTR template (P2) late | Use the standard CSC Form 48 layout; adjust after HR review |
| HR rules unclear (P4) | Use BUSINESS-RULES defaults (grace 0, lunch punches optional); change the rule set later without code changes |
| Behind schedule | Cut in this order: ① day remarks, ② merged PDF (keep ZIP), ③ employee CSV import (enter manually), ④ unlock (DB fix by admin), ⑤ dashboard warnings |
| Server not ready by Oct 29 | Demo on a laptop with Docker Compose; deploy the following week |

**Never cut:** duplicate protection, append-only raw punches, calculation tests, backups.
