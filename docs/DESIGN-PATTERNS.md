---
title: CVSU DTR — Design Patterns
version: 2.0
status: draft
updated: 2026-09-29
---

# CVSU DTR — Design Patterns

Related: [[CVSU-DTR/v3/ARCHITECTURE|ARCHITECTURE]] · [[CVSU-DTR/v3/MODULES|MODULES]] · [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]]

> **Rule:** Use a pattern only where it protects a business rule or isolates something that is expected to change. Each pattern below names the *change* it isolates.

---

## 1. Pattern map

| Pattern | Status | Where | Isolates / protects |
|---|---|---|---|
| Modular monolith | Required | Whole backend | Team size; simple deployment |
| Layered + ports & adapters | Required | Every non-trivial module | Domain from frameworks |
| Use case (application service) | Required | `application/*.use-case.ts` | Workflow + transaction boundary in one place |
| Repository (port) | Required | Aggregates with real queries | Persistence technology |
| Pure domain services | Required | `DayCalculator`, `SlotAssigner`, `PunchNormalizer`, `ScheduleValidator` | Business math from I/O |
| **Strategy** | Required | `FixedScheduleStrategy`, `FlexiScheduleStrategy` | Different attendance policies |
| **Versioned rule set (policy object)** | Required | `RuleSet` value object loaded from `attendance_rule_sets` | Policy values that change over time |
| **State machine (transition table)** | Required | DTR, schedule, exception, import, period | Illegal status changes |
| Adapter | Required | `AttendanceSource`, `FileStorage`, `DtrPdfGenerator`, `JobQueue`, `Clock` | External tech and devices |
| Registry | Recommended | `ParserRegistry` (MB20 xlsx, MB20 csv, …) | Export formats |
| Specification / rule list | Recommended | Import row validation; DTR validation guards | Growing lists of checks |
| Pipeline | Recommended | Processing: normalize → assign → calendar → exceptions → calculate → status | Readable, testable steps |
| Unit of work (transaction) | Required | Use cases touching several tables | Consistency |
| Idempotency key + natural keys | Required | Imports, processing, generation, finalize | Double submits and retries |
| Snapshot | Required | `dtr_items` at finalize + PDF hash | What was signed |
| Audit trail | Required | `AuditService` in the same transaction | Accountability |
| Domain events (in-process) | Phase 2 | `DtrFinalized` → notify | Side effects |
| CQRS / event sourcing / microservices | **Not used** | — | Not justified by the load |

---

## 2. Domain core: calculation

```ts
// domain/day-calculator.ts  — no imports from Nest, TypeORM, ExcelJS
export interface DayInput {
  date: LocalDate;
  punches: Punch[];                 // already resolved to this employee, local times
  schedule: DaySchedule | null;     // AM/PM groups from approved blocks (or override)
  calendar: CalendarEffect[];       // holiday, suspension from 15:00 …
  exceptions: ApprovedException[];
  rules: RuleSet;                   // versioned parameters (BUSINESS-RULES §5.1)
}

export interface DayResult {
  slots: { amIn?: LocalTime; amOut?: LocalTime; pmIn?: LocalTime; pmOut?: LocalTime };
  slotSources: Partial<Record<Slot, 'PUNCH' | 'CORRECTION' | 'CERTIFICATION'>>;
  scheduledMinutes: number; workedMinutes: number;
  tardyMinutes: number; earlyOutMinutes: number; undertimeMinutes: number;
  status: DayStatus; flags: DayFlag[]; isBlocking: boolean;
  usedPunchIds: string[]; ignoredPunchIds: string[];
  trace: TraceStep[];               // human-readable explanation for HR ("why 15 min late?")
}

export class DayCalculator {
  constructor(private readonly strategies: Record<RuleSet['strategy'], AttendanceStrategy>) {}
  calculate(input: DayInput): DayResult {
    const normalized = PunchNormalizer.normalize(input.punches, input.schedule, input.rules);
    const slots      = SlotAssigner.assign(normalized.kept, input.schedule, input.rules);
    const adjusted   = ExceptionApplier.apply(slots, input.exceptions);
    const excused    = CalendarApplier.apply(input.schedule, input.calendar, input.exceptions);
    const minutes    = this.strategies[input.rules.strategy].compute(adjusted, excused, input.rules);
    return StatusResolver.resolve({ normalized, adjusted, excused, minutes, input });
  }
}
```

- **`trace`** is what makes the system explainable. It is shown in the HR attendance drawer and returned by `/rule-sets/:id/simulate`.
- The whole [[CVSU-DTR/v3/BUSINESS-RULES#10. Reference test cases|test table]] is run as table-driven Jest tests against `DayCalculator`.
- Use a real date/time library (e.g., **Temporal polyfill** or `date-fns-tz`) wrapped behind `LocalDate` / `LocalTime` types. Never use raw JS `Date` arithmetic for local times.

## 3. Strategy + versioned rule set

```ts
export interface AttendanceStrategy {
  compute(slots: AdjustedSlots, schedule: ExcusedSchedule, rules: RuleSet): MinuteBreakdown;
}
// FixedScheduleStrategy  – BUSINESS-RULES §5.2–5.5
// FlexiScheduleStrategy  – BUSINESS-RULES §5.7
```
`RuleSetResolver.for(employee, date)` picks the PUBLISHED rule set whose `effective_from/to`, category and employment type match. A policy change creates a **new version**, and past results keep their old version.

## 4. State machine (transition table)

```ts
// domain/dtr-state-machine.ts
const T: Transition<DtrStatus, DtrAction>[] = [
  { action: 'submitForReview', from: ['DRAFT','RETURNED'],              to: 'FOR_REVIEW' },
  { action: 'validate',        from: ['FOR_REVIEW'],                    to: 'VALIDATED',
    guard: ctx => ctx.unresolvedBlocking === 0 },
  { action: 'return',          from: ['FOR_REVIEW','VALIDATED'],        to: 'RETURNED',
    guard: ctx => !!ctx.reason },
  { action: 'finalize',        from: ['VALIDATED'],                     to: 'FINALIZED',
    guard: ctx => !ctx.rules.twoPersonFinalize || ctx.actorId !== ctx.validatedBy },
  { action: 'markSubmitted',   from: ['FINALIZED'],                     to: 'SUBMITTED' },
  { action: 'receive',         from: ['FINALIZED','SUBMITTED'],         to: 'RECEIVED' },
  { action: 'rejectSubmission',from: ['SUBMITTED'],                     to: 'FINALIZED', guard: ctx => !!ctx.reason },
  { action: 'reopen',          from: ['FINALIZED','SUBMITTED','RECEIVED'], to: 'DRAFT', guard: ctx => !!ctx.reason },
];
export function transition(status, action, ctx): DtrStatus  // throws InvalidTransitionError / GuardFailedError
```
The same helper serves schedules, exceptions, imports and periods, each with its own table. **No `if (status === …)` checks scattered through services.** Role checks stay in the application layer; the table only knows states and guards.

## 5. Adapters (ports)

| Port | Phase 1 adapter | Later |
|---|---|---|
| `AttendanceSource` | `FileImportSource` (via `ParserRegistry`) | `AdmsPushSource`, `VendorSdkSource` |
| `AttendanceParser` | `Mb20XlsxParser`, `Mb20CsvParser` (columns confirmed from real exports) | Other device formats |
| `FileStorage` | `LocalDiskStorage` (volume, random keys) | `S3CompatibleStorage` |
| `DtrPdfGenerator` | `ChromiumHtmlPdfGenerator` (template `csc48.html`) | Alternative templates |
| `JobQueue` | `InlineJobQueue` (dev) / `PgBossJobQueue` | `BullMqJobQueue` |
| `Clock` / `BusinessCalendar` | `SystemClock('Asia/Manila')` | `FixedClock` in tests |
| `Notifier` | `NoopNotifier` | `EmailNotifier` (Phase 2) |

## 6. Import: registry + specification pipeline

```
file ─▶ ParserRegistry.detect(file) ─▶ parser.parse(stream) ─▶ RowSpec[] checks ─▶ staging + errors ─▶ summary
                                                       │
         RowSpecs: RequiredColumns, NonEmptyIdentifier, ValidDateTime, NotInFuture,
                   WithinSanityRange(±400 days), KnownDevice
```
Parsers **stream** rows (ExcelJS streaming reader) so memory doesn't grow with file size.

## 7. Transactions, idempotency and concurrency
- Every use case that changes state runs in `dataSource.transaction()`: state change + history + audit together.
- **Never** keep a transaction open across parsing, PDF rendering or network calls. Stage first, then commit fast.
- Idempotency: the natural keys in the DB (`UNIQUE(device_id, biometric_identifier, punched_at)`, `UNIQUE(employee_id, work_date)`, `UNIQUE(employee_id, dtr_period_id)`) plus an `Idempotency-Key` table for POSTs.
- Optimistic locking: TypeORM `@VersionColumn` on `dtrs` and `employee_schedules`, exposed as `If-Match`.
- Processing takes a PostgreSQL advisory lock per `dtr_period_id`, so there are never two runs on the same period.

## 8. Error handling
- Domain throws typed errors (`InvalidTransitionError`, `MakerCheckerViolationError`, `ScheduleOverlapError`…) that carry a stable `code`.
- The global filter maps them to HTTP (API-DESIGN §9). Domain code never throws `HttpException`.

## 9. Anti-patterns to avoid

| Anti-pattern | Instead |
|---|---|
| God `DtrService` (parsing + math + PDF + email) | Use cases + domain services + adapters |
| Business logic in controllers | Controllers only map DTO → use case |
| Generic `BaseRepository<T>` for every table | Repositories per aggregate with meaningful methods |
| Interfaces for every class | Ports only at real boundaries (table in §5) |
| Status checks spread across services | Transition tables (§4) |
| Hard-coded grace/office hours | Rule sets (§3) |
| JS `Date` math on local times | `LocalDate`/`LocalTime` wrappers + tz library |
| Updating raw punches to "fix" data | Exceptions (BUSINESS-RULES §8) |
| Premature Redis/queues/microservices | Inline or pg-boss first (STACK §6) |

## 10. Testing by layer

| Layer | Tool | What |
|---|---|---|
| Domain | Jest (table-driven) | Every BUSINESS-RULES §10 row; state-machine tables; schedule validator; ≥ 90% branch coverage |
| Parser | Jest + fixture files | Real (anonymized) MB20 exports, malformed files, huge file, zip bomb |
| Repository | Jest + Testcontainers PostgreSQL | Constraints (exclusion, maker-checker CHECK, append-only trigger), dedup |
| API | Supertest | Auth, scope 404s, transitions, idempotency, error codes |
| E2E | Playwright | Import → process → generate → validate → finalize → download for one department |
