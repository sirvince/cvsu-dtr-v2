---
title: CVSU DTR — Module Architecture
version: 3.0
status: draft
updated: 2026-10-05
---

# CVSU DTR — Modules

Related: [[CVSU-DTR/v3/ARCHITECTURE|ARCHITECTURE]] · [[CVSU-DTR/v3/DATABASE-MAPPING|DATABASE-MAPPING]] · [[CVSU-DTR/v3/API-DESIGN|API-DESIGN]]

> [!info] What changed in v3
> Source: [[CVSU-DTR/HR-Requirements-Analysis|HR-Requirements-Analysis]], ADR-21 … ADR-32 ([[CVSU-DTR/v3/README|README]] §2).
> - **New module `advance-credits`** owns the advance-credit ledger (ADR-23) and the pure reconciliation logic. **`processing` still runs every processing type** (`FULL`, `ADVANCE`, `RECONCILIATION`), so one period lock covers all of them.
> - **New module `offset`** owns earned offset, the offset ledger and the semester-end expiry job (ADR-29). **Wellness** (ADR-30) and **make-up classes** (ADR-31) stay inside the attendance **exceptions** area, because they have no balance table of their own (wellness) or are 1:1 with an exception (make-up).
> - **New infra leaf `events`** (in-process domain events). The **import commit → reconciliation** trigger uses an event, so `attendance-import` doesn't import `processing`'s reconciliation code or `advance-credits`. This brings forward the "domain event" option that v2 parked for Phase 2.
> - **Two-level approval** (ADR-28) adds an `endorse` step to `schedules` and `attendance` (exceptions). The shared maker-checker and approval-level checks are pure helpers in `common/approval`.
> - `academic-periods` handles **semi-monthly** periods (ADR-21) and finds the next open period for carry-forward (ADR-25). `calendar` adds `GOVERNMENT_ANNOUNCEMENT` (ADR-27). `dtr` adds advance totals and prior-period adjustment lines.
> - The module list (§1), the dependency graph (§2), the module notes (§4) and the responsibility matrix (§6) are updated. v2 content stays valid unless marked.

---

## 1. Module list

| Module | Owns (tables) | Public service (used by other modules) | API prefix |
|---|---|---|---|
| **auth** | `refresh_tokens`, `password_reset_tokens` | `AuthService` | `/auth` |
| **users** | `users`, `user_roles`, `user_department_scopes` | `UsersService.getActor()`, `ScopeService` | `/users` |
| **departments** | `departments` | `DepartmentsService` | `/departments` |
| **employees** | `employees`, `employee_biometric_ids` | `EmployeesService.resolveByBiometric()`, `.listActive()` | `/employees`, `/me` |
| **devices** | `biometric_devices` | `DevicesService` | `/biometric-devices` |
| **academic-periods** | `academic_years`, `semesters`, `dtr_periods` | `PeriodsService.getOpenPeriod()`; v3: `.createMonth(year, month)`, `.nextOpenPeriodAfter(periodId)`, `.semesterOf(date)`, `.academicYearOf(date)` | `/academic-years`, `/semesters`, `/dtr-periods` (v3: `/dtr-periods/month`) |
| **calendar** | `calendar_events` | `CalendarService.eventsFor(date, dept)` (v3: includes `GOVERNMENT_ANNOUNCEMENT`) | `/calendar-events` |
| **schedules** | `employee_schedules`, `schedule_blocks`, `schedule_templates` | `SchedulesService.approvedFor(employee, date)` | `/schedules`, `/me/schedules` (v3: `/schedules/:id/endorse`) |
| **attendance-import** | `attendance_import_batches`, `attendance_import_errors` | — (calls `AttendanceService.ingest`; v3: publishes `AttendanceImportCommitted`) | `/attendance-imports` |
| **attendance** | `raw_attendance_records`, `processed_attendance`, `attendance_exceptions`, `attendance_rule_sets`; v3: `makeup_class_details` | `AttendanceService.ingest()`, `.processedFor(employee, period)`; v3: `ExceptionsService.makeupAdjustmentsAppliedIn(employee, period)`, `.recordMakeupOutcome()`, `WellnessService.remaining(employee, academicYear)` | `/attendance`, `/attendance-exceptions`, `/rule-sets`; v3: `/employees/:id/wellness-balance`, `/me/wellness-balance` |
| **processing** *(sub-module of attendance)* | `processing_jobs` (v3: `processing_type`, `processed_until`, `import_batch_id`) | `ProcessingService.processPeriod()`; v3: `.runAdvance(period, processedUntil)`, `.reconcile(trigger, dates)`, `.runsForImport(batchId)` | `/dtr-periods/:id/process-attendance`, `/jobs`; v3: `/dtr-periods/:id/processing-runs`, `/processing-runs/:id`, `/dtr-periods/:id/reconcile` |
| **advance-credits** *(v3)* | `advance_credits`, `advance_credit_events` | `AdvanceCreditsService.createForRun(tx, run, days)`, `.openCreditsFor(period, dates)`, `.applyOutcome(tx, creditId, outcome)`, `.adjustmentsAppliedIn(employee, period)` | `/advance-credits`, `/employees/:id/advance-credits`, `/dtr-periods/:id/advance-credits/summary` |
| **offset** *(v3)* | `offset_earning_requests`, `offset_ledger` | `OffsetService.balance(employee, semester)`, `.use(tx, exceptionId, minutes)`, `.reverseUse(tx, exceptionId)`, `.expireSemester(semesterId)` | `/offset-earning-requests`, `/employees/:id/offset-balance`, `/employees/:id/offset-ledger`, `/me/offset-*` |
| **dtr** | `dtrs`, `dtr_items`, `dtr_status_history` | `DtrService` | `/dtrs`, `/me/dtrs` (v3: `/dtrs/:id/adjustments`) |
| **documents** *(sub-module of dtr)* | — | `DtrPdfGenerator` (port) | — |
| **reports** | — (read-only queries/views) | — | `/reports` |
| **files** | `stored_files` | `FileStorage` (port) | `/files/:id` (authorized download) |
| **audit** | `audit_logs` | `AuditService.record()` | `/audit-logs` |
| **jobs** *(infra)* | pg-boss tables | `JobQueue` (port); v3: scheduled (cron) jobs in Phase 1B | — |
| **events** *(infra, v3)* | — | `DomainEventBus` (port): `publishAfterCommit(event)`, `subscribe(type, handler)` | — |
| **health** *(infra)* | — | — | `/health` |

> v1 → v2: **added** `devices`, `calendar`, `processing`, `documents`, `jobs`, `health`. **Removed** the idea that Attendance Import stores raw attendance; it hands normalized punches to `AttendanceService.ingest()`.
>
> v2 → v3: **added** `advance-credits`, `offset`, `events`. **Extended** `academic-periods`, `calendar`, `schedules`, `attendance` (exceptions, make-up, wellness), `processing` and `dtr`. No module was removed.

**Why `advance-credits` is its own module and not part of `processing`** (ADR-23):
- Processing output (`processed_attendance`) is derived and can be rebuilt (ADR-04). Advance credits are decisions made at a point in time and **must survive any rebuild**. Separate ownership makes "rebuild never touches the ledger" a module boundary, not just a coding convention. The DB grants back it up ([[CVSU-DTR/v3/DATABASE-MAPPING|DATABASE-MAPPING]] §8.1).
- **Running** the work stays in `processing`, because `ADVANCE` and `RECONCILIATION` are processing types. They share the per-period advisory lock and the `processing_jobs` history. `processing` calls `advance-credits`; never the other way round.

**Why `offset` is a module but wellness is not:** offset has its own tables, a request workflow and a scheduled job. Wellness is only a limit counted over existing exceptions, so it is a rule (Specification) inside the exceptions area.

## 2. Dependency graph (actual imports)

```
                         ┌────────┐
                         │ audit  │◀──────────────── (everyone that changes state)
                         └────────┘
 auth ──▶ users ──▶ departments
                        ▲
 employees ─────────────┘        devices
     ▲  ▲                           ▲
     │  └───────────────┐           │
 schedules ──▶ academic-periods     │
     ▲              ▲               │
     │              │               │
 attendance ────────┴──▶ calendar   │
   ▲   (processing uses employees, schedules, calendar, periods)
   │                                │
 attendance-import ─────────────────┘  (uses attendance.ingest, employees, devices, files)
   
 dtr ──▶ attendance (processedFor), employees, academic-periods, files, documents
 reports ──▶ read models of attendance, dtr, attendance-import (read-only)
```

**v3 additions** (only the new or changed edges; everything above still holds):

```
                       ┌────────┐
                       │ events │◀── publish ── attendance-import   (AttendanceImportCommitted)
                       │ (leaf) │◀── publish ── attendance/exceptions (ExceptionApproved, ExceptionRevoked)
                       └────────┘
                           ▲ subscribe
                           │
 attendance/processing ────┘      runs FULL | ADVANCE | RECONCILIATION
     │
     ├──▶ advance-credits ──▶ academic-periods (nextOpenPeriodAfter), audit
     ├──▶ attendance/exceptions (recordMakeupOutcome)      [same module]
     └──▶ schedules, calendar, employees                   [as in v2]

 attendance/exceptions ──▶ offset (balance check + USED entry, in the approve transaction)
                       ──▶ academic-periods (academicYearOf: wellness limit)
 offset ──▶ employees, academic-periods (semesterOf, semester end), files, jobs (cron), audit
 schedules ──▶ users (ScopeService: endorser scope)        [endorse step]

 dtr ──▶ advance-credits (adjustmentsAppliedIn)            [carry-forward lines]
     ──▶ attendance (makeupAdjustmentsAppliedIn)
 reports ──▶ read models of advance-credits, offset (read-only)
```

**How the import commit triggers reconciliation without a direct import:**
1. `CommitImportUseCase` (attendance-import) commits the punches, then calls `DomainEventBus.publishAfterCommit(AttendanceImportCommitted { batchId, deviceId, detectedDateFrom, detectedDateTo, committedBy })`.
2. `processing` subscribes. Its handler enqueues `RECONCILE_ADVANCE_CREDITS` on `JobQueue` with `singletonKey = batchId`, so a retry never runs twice.
3. The job runs a `RECONCILIATION` processing run per affected period: it recomputes the covered credited dates and make-up dates from actual data, gets the outcome from `advance-credits` (pure `ReconciliationService`), and writes credit events and make-up outcomes.
4. `CommitImportUseCase` builds the commit response's reconciliation summary from `ProcessingService.runsForImport(batchId)`. It is allowed to call that because `attendance-import → attendance` already exists.
   - **Phase 1** (`InlineJobQueue`): the job has already finished, so the summary is complete.
   - **Phase 1B** (pg-boss): the run may still be `QUEUED`.

`attendance-import` never references `advance-credits`, and `advance-credits` never references `attendance-import`. The event contract (`AttendanceImportCommitted`) lives in `packages/shared` (or `common/events`), so neither side owns the other.

Rules:
1. A module calls another module **only through that module's public service**, never its repository or entities.
2. No cycles. If one appears, move the shared concept down, or use a domain event. *(v2 said "Phase 2"; v3 uses events from Phase 1+ for import commit and exception approval → reconciliation.)*
3. `audit`, `files`, `jobs` **and `events`** are leaf modules. They import nothing from business modules.
4. `forwardRef()` is not allowed without a written reason in the README ADR table.
5. *(v3)* `advance-credits` and `offset` **don't depend on `attendance`**. `processing` passes the actual day to `advance-credits` as a plain value (`ActualDayOutcome`), and `exceptions` calls `offset`. Otherwise `offset → attendance → offset` would be a cycle. This is why the earned-offset approval screen reads punches through the existing `GET /employees/:id/raw-punches` (API-DESIGN §5.13) instead of `offset` calling `attendance`.
6. *(v3)* Event handlers must be **idempotent** (keyed jobs). An event lost in a crash is recovered with the manual re-run (`POST /dtr-periods/:id/reconcile`). ⚠ There is no transactional outbox in Phase 1. Add one only if lost events turn out to be a real problem.

## 3. Standard module layout

```
modules/attendance/
├── attendance.module.ts
├── api/                       # controllers + DTOs
│   ├── attendance.controller.ts
│   ├── exceptions.controller.ts
│   └── dto/
├── application/               # use cases
│   ├── ingest-punches.use-case.ts
│   ├── process-period.use-case.ts
│   └── approve-exception.use-case.ts
├── domain/                    # pure TS
│   ├── day-calculator.ts
│   ├── slot-assigner.ts
│   ├── punch-normalizer.ts
│   ├── strategies/ (fixed.strategy.ts, flexi.strategy.ts)
│   ├── rule-set.ts
│   └── errors.ts
├── ports/                     # interfaces
│   └── attendance.repository.ts
└── infrastructure/
    ├── entities/
    └── typeorm-attendance.repository.ts
```

Small modules (departments, devices, calendar) may collapse `application` + `domain` into a single service.

v3 example for the new ledger module:
```
modules/advance-credits/
├── advance-credits.module.ts
├── api/advance-credits.controller.ts          # read-only endpoints
├── application/
│   ├── create-credits-for-run.ts              # called by processing inside its transaction
│   └── apply-reconciliation-outcome.ts        # status change + advance_credit_events row + audit
├── domain/
│   ├── advance-credit.ts                      # entity + transition table (ADVANCED → …)
│   ├── advance-credit.service.ts              # AdvanceCreditService: credit from schedule minutes
│   └── reconciliation.service.ts              # ReconciliationService: pure (credit, actual) → outcome
└── infrastructure/ (entities, typeorm repository: INSERT/UPDATE only, never DELETE)
```

## 4. Module notes

### employees
- Owns the **biometric ID mapping** with validity dates (`valid_from/valid_to`) so that a re-enrolled or transferred ID keeps its history.
- `resolveByBiometric(deviceId, biometricIdentifier, date)` → employeeId | null.
- Bulk import of the employee master list (CSV), validated row by row like attendance imports.

### academic-periods (v3 changes)
- Semi-monthly periods (ADR-21): `createMonth(year, month)` creates both halves in one transaction; the DB enforces the half-month shape (DATABASE-MAPPING §5).
- `nextOpenPeriodAfter(periodId)` is the **single place** that decides where a carry-forward adjustment lands (ADR-25). `advance-credits` and `exceptions` (make-up) both use it.
- `semesterOf(date)` and `academicYearOf(date)` serve offset validity (ADR-29) and the wellness limit (ADR-30).

### calendar (v3 changes)
- `GOVERNMENT_ANNOUNCEMENT` events (ADR-27): `scope = ALL` only, optional start/end time. `eventsFor()` returns them like other calendar effects, and the calculator applies them (BUSINESS-RULES §5.6, §8).

### schedules
- Schedule approval workflow (BUSINESS-RULES §6, §9).
- `approvedFor(employeeId, date)` returns the blocks grouped as AM/PM for the calculator.
- Templates such as "Regular 8–5" and "Faculty MWF/TTh" reduce data-entry errors.
- *(v3, ADR-28)* Two levels: `SUBMITTED → ENDORSED` (Department Head, in scope) → `APPROVED` (HR). The transition table gains `endorse`. Maker-checker and level checks come from `common/approval`.

### attendance-import
- Pipeline: store file → detect format (`ParserRegistry`) → parse rows → row validation → preview summary → **commit**, which calls `AttendanceService.ingest()` in batches.
- It never calculates tardiness and never writes `raw_attendance_records` directly.
- *(v3)* After the commit transaction it publishes `AttendanceImportCommitted`, and it adds the reconciliation summary to the commit response (§2). It **knows nothing** about advance credits.

### attendance
- **ingest**: `INSERT … ON CONFLICT (device_id, biometric_identifier, punched_at) DO NOTHING` and returns inserted/duplicate counts.
- **processing**: implements BUSINESS-RULES §3–§5 and writes `processed_attendance`. It skips dates locked by FINALIZED+ DTRs.
- **exceptions**: maker-checker approval; approving marks the affected days stale.
- **rule sets**: versioned, immutable once published.
- *(v3)* **processing** runs three types (ADR-22, ADR-24):
  - `FULL`: as in v2.
  - `ADVANCE`: actual days up to `processedUntil`; after it, `ADVANCE` days plus `AdvanceCreditsService.createForRun()`, in the same transaction.
  - `RECONCILIATION`: recomputes credited and make-up dates from actual data, then hands each actual result to `advance-credits` / `exceptions`.
  - Every processed day records `attendance_basis` (ADR-26). The rules are in [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] §12.
  - Reconciliation **may recompute credited dates of a finalized DTR**. It never touches `dtr_items`; the difference is carried forward (DATABASE-MAPPING §8).
  - Processing subscribes to `AttendanceImportCommitted` and `ExceptionApproved`/`ExceptionRevoked` (re-reconcile a date that is already reconciled, D-HR-09).
- *(v3)* **exceptions** (ADR-27, ADR-28, ADR-30, ADR-31):
  - New types: `ASYNCHRONOUS` (HR-entered, auto-approved), `OFFSET`, `WELLNESS`, `MAKE_UP_CLASS`.
  - The `endorse` step; per-type approval levels.
  - Approving an `OFFSET` calls `OffsetService.use()` in the same transaction; revoking it calls `.reverseUse()`.
  - The **wellness limit** is a Specification over this module's own exceptions. `WellnessService.remaining()` serves `/wellness-balance`.
  - Owns `makeup_class_details` (1:1 with the exception) and its outcome; `recordMakeupOutcome()` is called by processing.
  - Each type's effect on a day is a strategy (DESIGN-PATTERNS §3.1).

### advance-credits (v3)
- Owns the **advance-credit ledger** (ADR-23): a credit per employee per credited date, and an append-only event history (D-HR-19).
- `createForRun()`: one `ADVANCED` credit + `CREATED` event per date with scheduled minutes (rest days and holidays get none).
- `applyOutcome()`: takes the outcome from the pure `ReconciliationService` (`RECONCILED`, `ADJUSTED`, `REVERSED`, `RESTORED`, `CANCELLED`). It asks `academic-periods` for the next open period and writes the status, the event and the audit entry in one transaction.
- `adjustmentsAppliedIn(employee, period)` returns the carry-forward lines and their total for the DTR.
- **Never** deleted or rebuilt by reprocessing. The repository has no delete method.

### offset (v3)
- Earned offset: request → Head/Dean approval (one level, maker-checker) → `EARNED` ledger entry (ADR-28, ADR-29).
- Balance per employee per semester = sum of the append-only ledger. `use()` checks and writes `USED` under an advisory lock (DATABASE-MAPPING §7).
- **Semester-end expiry**: a scheduled `OFFSET_EXPIRY` job (pg-boss cron, Phase 1B) calls `expireSemester()`. It is idempotent: one `EXPIRED` entry per employee and semester.
- Doesn't depend on `attendance` (rule 5 in §2).

### dtr
- Generate / regenerate from `processed_attendance`.
- State machine (BUSINESS-RULES §7) implemented as a transition table in the domain layer.
- Finalize: snapshot items → `DtrPdfGenerator.render()` (worker) → `FileStorage.save()` → store `file_id` + SHA-256.
- *(v3)* One DTR per **semi-monthly** period (ADR-21).
  - Items copy `attendance_basis` and `ADVANCE_CREDIT` days; those days print schedule times with no remark (ADR-22).
  - Totals add `advance_credit_minutes` and `prior_period_adjustment_minutes`. The adjustment lines come from `AdvanceCreditsService.adjustmentsAppliedIn()` and `ExceptionsService.makeupAdjustmentsAppliedIn()`.
  - `dtr` never computes an adjustment itself.

### reports
- Read-only. May use SQL views (e.g., `v_dtr_submission_status`) for aggregation.
- Never mutates data. Exports run as jobs.

### audit
- `record({actor, action, entityType, entityId, before?, after?, reason?, requestId})`
- Also records **sensitive reads**: HR viewing another person's DTR or attendance (SECURITY-PRIVACY §5).

## 5. Implementation order

Modules are built in dependency order: auth/users → org & calendar → schedules → import → processing → exceptions → DTR → reports. The sprint-by-sprint plan, dates and milestones are in [[CVSU-DTR/v3/DEVELOPMENT-PHASES|DEVELOPMENT-PHASES]].

## 6. Responsibility matrix

| Module | Owns | Must NOT |
|---|---|---|
| attendance-import | Files → validated normalized punches | Calculate tardiness; write raw table directly |
| attendance | Punch storage, processing, exceptions, rule sets | Parse Excel; render PDFs |
| schedules | Expected time | Store actual punches |
| dtr | DTR lifecycle, snapshot, PDF request | Recalculate attendance itself |
| reports | Aggregated read models | Mutate anything |
| users | Accounts, roles, scopes | Decide attendance values |
| audit | Append-only history | Business logic |
