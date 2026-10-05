---
title: CVSU DTR — Review of v1 Documentation and Recommendations
version: 2.0
status: draft
updated: 2026-09-29
reviewed:
  - ARCHITECTURE.md.md
  - MODULES.md.md
  - DESIGN-PATTERNS.md.md
  - DATABASE-MAPPING.md.md
  - API-DESIGN.md.md
  - STACK.md.md
  - UI_DESIGN.md.md
---

# CVSU DTR — Review of v1 and Recommendations

> [!summary] Verdict
> The v1 set has a **solid architecture**: a modular monolith, raw attendance kept separate from processed attendance and from the DTR, parser/adapter abstractions, calculation kept separate from document generation, and audit logging. It is **not implementation-ready yet**, for three reasons:
> 1. **The documents contradict each other.** Roles, table names, API paths and the DTR workflow differ between files.
> 2. **The core business rules are missing.** Tardiness, undertime, grace period, AM/PM slots, holidays, leave and flexi-time are never defined. These rules are the product.
> 3. **Several data-model decisions break the stated principles.** Examples: "immutable" raw records that still get updated, and adjustments that are lost when attendance is reprocessed.
>
> v2 fixes these. See [[CVSU-DTR/v3/README|v2 README]] for the new document set.

---

## 1. What v1 does well (kept in v2)

| Strength | Where |
|---|---|
| Modular monolith with no premature microservices | ARCHITECTURE §3, DESIGN-PATTERNS §4 |
| Raw → Processed → DTR separation | DATABASE-MAPPING §50 |
| Raw biometric data treated as evidence | all docs |
| DTR *calculation* separate from DTR *document generation* | ARCHITECTURE §10, MODULES §19 |
| `AttendanceSource` / `AttendanceParser` abstractions for Phase 2 device sync | ARCHITECTURE §24, DESIGN-PATTERNS §12–14 |
| Server-side authorization, `/me` endpoints, ownership checks | API-DESIGN §9, DATABASE-MAPPING §39 |
| Consistent response envelope, stable error codes, request IDs | API-DESIGN §41–45 |
| Calm, task-first UI direction with an HR "Needs Attention" queue | UI_DESIGN §48, §65 |
| An explicit list of things to avoid (Kafka, K8s, CQRS…) | STACK §54, DESIGN-PATTERNS §29 |

---

## 2. Cross-document inconsistencies

These must be resolved before coding. If they aren't, two developers following two documents will build two different systems.

| # | Topic | Conflict | v2 resolution |
|---|---|---|---|
| C1 | **Roles** | ARCHITECTURE §6 lists `SYSTEM_ADMIN, HR_ADMIN, HR_STAFF, DEPARTMENT_ADMIN, EMPLOYEE`. MODULES, DB, API and PATTERNS use `ADMIN, HR, EMPLOYEE`. | 5 roles, multi-role per user: `SYSTEM_ADMIN, HR_ADMIN, HR_STAFF, DEPARTMENT_HEAD, EMPLOYEE` (a department head is also an employee) |
| C2 | **Role storage** | ARCHITECTURE §8 has `roles` and `permissions` tables. DB §5 has a single `users.role` column. | `user_roles` join table. Permissions live as code constants in Phase 1. |
| C3 | **Table names** | ARCHITECTURE §8: `attendance_records`, `dtr_entries`, `schedules`, `periods`, `positions`, `dtr_status_history`. DB doc: `raw_attendance_records`, `dtr_items`, `employee_schedules`, `dtr_periods`, and none of `positions` / `dtr_status_history`. | One canonical list in [[CVSU-DTR/v3/DATABASE-MAPPING]]. `dtr_status_history` is **added**; `position` becomes a column. |
| C4 | **Period FK naming** | `period_id` (imports, dtrs) vs `dtr_period_id` (processed_attendance) | `dtr_period_id` everywhere |
| C5 | **Employee status column** | `employment_status` (DB §7) vs `employees.status` (DB §28) | `status` (ACTIVE/INACTIVE) plus a separate `employment_type` |
| C6 | **API paths** | ARCHITECTURE §20: `/dtr`, `/academic-periods`. MODULES §37: `/attendance-import`, `/dtr`. API-DESIGN: `/attendance-imports`, `/dtrs`, `/academic-years`, `/semesters`, `/dtr-periods`. | Plural resource names everywhere. API-DESIGN v2 is the single source. |
| C7 | **`/me/schedule` vs `/me/schedules`** | API-DESIGN §9 and §12 use the singular; §16 and §54 use the plural | `/me/schedules` |
| C8 | **DTR workflow order** | Status chain says HR validates → finalizes → employee downloads → signs. MODULES §18 and STACK §58 say the employee signs → submits → *then* HR validates. | One lifecycle (see §4 below and [[CVSU-DTR/v3/BUSINESS-RULES#7. DTR lifecycle]]) |
| C9 | **Submission status is tracked twice** | DTR status `SIGNED_SUBMITTED` and the `dtr_submissions.status` enum (PENDING/SUBMITTED/RECEIVED/RETURNED/ACCEPTED) overlap. UI shows `RETURNED`, which is not a DTR status. | One DTR state machine that includes `RETURNED`, `SUBMITTED` and `RECEIVED`. `dtr_submissions` is replaced by columns plus `dtr_status_history`. |
| C10 | **`DOWNLOADED` as a status** | Downloading is a repeatable *event*, not a state. It would move a DTR backward in meaning if HR re-validates. | Removed from the state machine. Logged as the `DTR_DOWNLOADED` audit event. |
| C11 | **Import status enum** | MODULES §15 has no `PROCESSING` state, but API §25 and §27 return `PROCESSING` | Import statuses only describe the *file*. Processing is a separate job with its own status. |
| C12 | **Who can view audit logs / manage schedules** | API §8: HR can view audit logs and only EMPLOYEE can "manage own schedule", yet API §15 lets HR create schedules. ARCHITECTURE puts audit logs under admin. | Full permission matrix in [[CVSU-DTR/v3/API-DESIGN#4. Roles and permissions]] |
| C13 | **Broken references** | MODULES, DB and PATTERNS list `GO-STACK.md` (does not exist; looks left over from a Go draft). STACK.md is never referenced by the older docs. | Fixed. v2 docs link each other with Obsidian wikilinks. |
| C14 | **File names** | Every file is `*.md.md` (double extension) | v2 uses `*.md` |
| C15 | **Module dependency graph** | MODULES §33 shows `Schedules → Attendance Import` and `Files → Audit`; neither dependency exists. Attendance Import is said to "store raw attendance", but raw attendance is owned by Attendance (DB §38). | Corrected graph. Import *parses and validates*; Attendance *owns and stores* raw punches. |
| C16 | **Redis/BullMQ: required or optional?** | ARCHITECTURE §23 says "optional", while STACK §55/§57 lists it in the final baseline | Optional. Phase 1 uses in-process jobs or `pg-boss` (see R-S3). |
| C17 | **Semester example dates** | ARCHITECTURE §6: 1st Sem June 1 – Oct 31. API §15 sample schedule: Aug 1 – Dec 31. | Examples use one consistent academic calendar and are marked "sample only". |

---

## 3. Design flaws (the model contradicts its own principles)

### F1 — Raw attendance is "immutable" but gets updated
DB §15 makes `raw_attendance_records.employee_id` nullable so that "HR can then resolve the mapping". That requires `UPDATE raw_attendance_records`, which DB §16 forbids.

**v2:** Raw punches store only what the device exported (`device_id`, `biometric_identifier`, `punched_at`, `raw_payload`). The link to an employee is resolved **at processing time** through a new `employee_biometric_ids` mapping table, which also has validity dates. If an ID is unmatched, HR maps it and reprocesses; the raw row is never changed. Immutability is enforced in the database: the app role gets no UPDATE/DELETE grant on the table.

### F2 — Adjustments are lost on reprocessing
`attendance_adjustments.processed_attendance_id → processed_attendance.id`. Processed rows are derived data and are meant to be recalculated (DB §34), so every recalculation would orphan or drop HR-approved corrections, leave and official business.

**v2:** Rename to **`attendance_exceptions`**, keyed by `(employee_id, work_date)` rather than by a processed row. Processing reads approved exceptions as an *input*. Processed attendance can then be deleted and rebuilt at any time.

### F3 — Processing is triggered per import batch
`POST /attendance-imports/:id/process` runs schedule matching and calculation per file. Biometric exports usually **overlap** (HR exports "last 30 days" every week), and one employee-day can have punches in two files. Per-batch processing gives wrong or duplicated days.

**v2:** Import only parses, validates and commits raw punches. Calculation runs **per DTR period** (optionally per employee): `POST /dtr-periods/:id/process-attendance`.

### F4 — File-hash uniqueness is the wrong duplicate guard
`UNIQUE(file_hash)` blocks legitimate re-uploads and does nothing against overlapping exports with different hashes.

**v2:** Keep the file hash only as a warning. The real guard is record-level: `UNIQUE(device_id, biometric_identifier, punched_at)` with `ON CONFLICT DO NOTHING`. The import summary shows "new / already-known / invalid" counts.

### F5 — The data model doesn't match the government DTR
The official DTR (**CSC Form No. 48**) has **four time slots per day**: A.M. Arrival, A.M. Departure, P.M. Arrival, P.M. Departure. It also has undertime hours and minutes. v1 schedules have only `time_in / time_out / break`, processed attendance has only `time_in / time_out`, and `dtr_items` has *both* time_in/out and am_in…pm_out, which is redundant.

**v2:** Schedules are made of **time blocks** (so split schedules work). Processed attendance and DTR items use `am_in, am_out, pm_in, pm_out`. The punch-to-slot assignment rule is written down in BUSINESS-RULES.

### F6 — One schedule entry per day
`UNIQUE(employee_schedule_id, day_of_week)` makes split or teaching schedules impossible, for example 07:00–10:00 plus 13:00–18:00, which are common for faculty.

**v2:** `schedule_blocks(day_of_week, block_no, start_time, end_time)`.

### F7 — Employees can edit their own expected schedule without approval
Employees "manage their schedule". Tardiness is computed against that schedule, so an employee could remove their own tardiness after the fact.

**v2:** Schedule workflow `DRAFT → SUBMITTED → APPROVED/REJECTED` (approver: Department Head or HR). Only **approved** schedules are used in calculation. Schedules lock once a period's DTR is finalized.

### F8 — The same role requests and approves corrections
HR creates *and* approves attendance adjustments. There is no segregation of duties.

**v2:** Maker-checker. `requested_by ≠ reviewed_by` is enforced in the service and checked in the DB. Employees can also *request* corrections (for example a missed punch while on official business), and HR reviews them.

### F9 — No calendar data
There are no tables for holidays, special non-working days, work suspensions (typhoons, declared suspensions) or campus events. Without them, every holiday shows up as an absence.

**v2:** `calendar_events` table plus a Calendar module.

### F10 — No history of DTR state changes
ARCHITECTURE mentions `dtr_status_history`, but the DB doc omits it. `dtrs` only records the *last* validator and finalizer, so returns and reopens are lost.

**v2:** `dtr_status_history(from_status, to_status, actor, remarks, at)`.

### F11 — Timestamp types left open
`attendance_time TIME / TIMESTAMPTZ` is undecided. Device exports are local times with no timezone.

**v2:** `punched_at TIMESTAMPTZ` (the export's local time interpreted as `Asia/Manila`) plus `punch_date DATE`, computed as the Manila local date.

### F12 — Biometric ID assumed unique per employee
CvSU has several campuses and offices, likely with several devices. The same enrolment number can exist on two devices, and one employee can be enrolled on several.

**v2:** `biometric_devices` table plus `employee_biometric_ids(employee_id, device_id, biometric_identifier, valid_from, valid_to)`.

---

## 4. The biggest gap: business rules

Every v1 document defers the real rules ("should be confirmed with HR"). They are the core of the system and must be written down **before** building calculators. v2 adds [[CVSU-DTR/v3/BUSINESS-RULES]], which contains:

- punch normalization (double-tap removal, out-of-window punches)
- the punch → AM/PM slot assignment algorithm
- tardiness, undertime and worked-minutes formulas
- grace period, rounding and flexi-time as **configurable, versioned rule sets**
- handling of holidays, work suspensions, leave, official business, half-days and rest days
- faculty vs non-teaching vs COS/JO rule differences
- habitual-tardiness flagging (CSC rule — verify with HR)
- a worked **test-case table**, which becomes the unit tests
- a list of **open questions for CvSU HR**, each with a proposed default

The DTR lifecycle is also unified:

```
DRAFT ──(employee confirms / HR bulk-sends)──▶ FOR_REVIEW ──(HR_STAFF)──▶ VALIDATED ──(HR_ADMIN)──▶ FINALIZED
  ▲                                              │                          │                        │ PDF locked + hash
  └────────────────── RETURNED ◀─────────────────┴──────────────────────────┘                        ▼
  ▲                                                                                         (print, wet-sign,
  └──────────── REOPENED by HR_ADMIN (reason required) ◀────── FINALIZED            In-Charge signs) SUBMITTED ──▶ RECEIVED
```

---

## 5. Missing non-functional topics

| Gap | Why it matters | v2 |
|---|---|---|
| **Data Privacy Act of 2012 (RA 10173)** | Attendance and biometric-linked data is personal information. It needs a privacy notice, lawful basis, a retention period, access logging and breach procedure. | [[CVSU-DTR/v3/SECURITY-PRIVACY]] |
| **Records retention** | DTRs are government records, so the disposal schedule must follow the university records officer / NAP schedule | SECURITY-PRIVACY §Retention |
| **Refresh-token storage and revocation** | Logout and "log out all devices" can't work without a server-side token table | `refresh_tokens` table; rotation with reuse detection |
| **Token storage in browser** | Not specified. localStorage is exposed to XSS. | Access token in memory, refresh token in an httpOnly Secure SameSite cookie |
| **Account provisioning** | How do ~850 employees get accounts? | Bulk import of employees plus invitation / first-login set-password flow. Optional future SSO (Google Workspace / OIDC) if CvSU uses it. |
| **Spreadsheet library risk** | The npm `xlsx` package (0.18.5) is unmaintained on npm and has known CVEs (prototype pollution, ReDoS). Fixed versions ship only from SheetJS's own CDN. | Use **ExcelJS** + `csv-parse`, with zip-bomb and row limits |
| **CSV/Excel formula injection** in exported reports | Cells starting with `=`, `+`, `-`, `@` can execute formulas in Excel | Escape them on export |
| **Requirements and acceptance criteria** | No SRS or user stories, so "done" can't be tested | [[CVSU-DTR/v3/REQUIREMENTS]] |
| **Real import file sample** | The parser contract depends on the actual MB20 export columns | REQUIREMENTS: "Obtain 3 real exports" listed as a blocker |
| **Deployment target** | Hostinger is mentioned. Shared hosting can't run Docker, Node workers or Postgres properly. | VPS or on-prem university server with Docker Compose |
| **Backups** | Mentioned but no RPO/RTO | SECURITY-PRIVACY §Backups |

---

## 6. Recommendations

### Scope and process
- **R-P1 — Define an MVP.** v1 describes an enterprise-scale system across 12,800 lines. For a first release: file import → processing → DTR generation (CSC Form 48 PDF) → HR validate/finalize → submission tracking, for **one campus**. Defer Redis, email, notifications and device sync.
- **R-P2 — Get the real inputs first.** (a) 2–3 real biometric export files, (b) the official DTR template CvSU uses, (c) HR's written attendance policy. These three unblock the parser, the generator and the calculators.
- **R-P3 — One source of truth per topic.** v1 repeats the same flow diagrams in every file. v2 states each fact once and links to it.
- **R-P4 — Keep an ADR log.** Record decisions and their reasons in the README decision table so later changes are traceable.

### Data and domain
- **R-D1** Raw punches are append-only and enforced by DB grants. Resolve employees at processing time (F1).
- **R-D2** Exceptions are keyed by employee+date, and processed attendance is fully rebuildable (F2).
- **R-D3** Process per DTR period, not per import (F3). Deduplicate at record level (F4).
- **R-D4** Use the four-slot AM/PM model aligned with CSC Form 48 (F5), and schedule blocks (F6).
- **R-D5** Schedules need approval, and only approved schedules count (F7).
- **R-D6** Add a versioned rule-set table (`attendance_rule_sets`) so a policy change creates a new version instead of a code edit. Every processed day and every DTR stores the rule-set version used.
- **R-D7** Snapshot DTR items at finalization, and store the SHA-256 of the generated PDF so the printed copy can be verified later.

### Security and governance
- **R-G1** Maker-checker for exceptions and for finalization (F8).
- **R-G2** Department scoping: HR_STAFF and DEPARTMENT_HEAD see only their assigned departments.
- **R-G3** Add a privacy notice, a retention policy and audit logging of *reads* of other people's DTRs (not only writes).

### Stack
- **R-S1** Use **Node.js 24 LTS**. v1 suggests 22, which is in maintenance LTS until April 2027.
- **R-S2** Use a **monorepo** (Yarn 4 workspaces): `apps/api`, `apps/web`, `packages/shared` for enums such as roles and statuses. Generate frontend API types from OpenAPI (`openapi-typescript`) instead of hand-writing them twice.
- **R-S3** For background jobs in Phase 1, use **pg-boss** (Postgres-backed) or run synchronously. Redis + BullMQ come only when measured load requires them, which keeps one data store to run and back up.
- **R-S4** Use **ExcelJS + csv-parse**, not the npm `xlsx` package.
- **R-S5** For the DTR PDF, render an HTML/CSS template of CSC Form 48 to PDF with headless Chromium (Puppeteer), in a worker. This is easy to match pixel-for-pixel and to print two copies per page. Avoid LibreOffice headless unless CvSU's template is a .docx/.xlsx that must be reused exactly.
- **R-S6** Use **Yarn** (v4, pinned with `packageManager` and Corepack) as the only package manager. v1 left Yarn vs npm open; the project has now chosen Yarn.

### UI
- **R-U1** Add screens that v1 misses: Department Head approval queue, employee "Confirm DTR / Request correction", calendar management, biometric ID mapping for unmatched IDs, and a DTR preview laid out like CSC Form 48.
- **R-U2** Display 12-hour time (`8:05 AM`), which is what Philippine users expect and what paper DTRs use. Store 24-hour.
- **R-U3** Add print styles and test on low-end Android phones. Employee usage will be mostly mobile.

---

## 7. v2 document set

| v2 document | Change vs v1 |
|---|---|
| [[CVSU-DTR/v3/README]] | **New.** Index, canonical decisions (ADR table), glossary, changelog |
| [[CVSU-DTR/v3/REQUIREMENTS]] | **New.** Scope, MVP, user stories, acceptance criteria, blockers |
| [[CVSU-DTR/v3/BUSINESS-RULES]] | **New.** Calculation rules, lifecycles, test cases, open questions for HR |
| [[CVSU-DTR/v3/ARCHITECTURE]] | Condensed. Fixes the workflow and module boundaries. |
| [[CVSU-DTR/v3/MODULES]] | Adds Calendar and Devices modules and fixes the dependency graph |
| [[CVSU-DTR/v3/DATABASE-MAPPING]] | Canonical schema with fixes F1–F12 and DDL-level constraints |
| [[CVSU-DTR/v3/API-DESIGN]] | Canonical endpoints, full permission matrix, lifecycle actions |
| [[CVSU-DTR/v3/DESIGN-PATTERNS]] | Condensed, with the state machine and versioned rule sets added |
| [[CVSU-DTR/v3/STACK]] | Node 24, monorepo, pg-boss, ExcelJS, Puppeteer, all decisions final |
| [[CVSU-DTR/v3/UI_DESIGN]] | Adds the new screens, route map per role, time format and print rules |
| [[CVSU-DTR/v3/SECURITY-PRIVACY]] | **New.** Auth, RA 10173, retention, backups, threat list |
