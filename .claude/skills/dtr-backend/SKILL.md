---
name: dtr-backend
description: Build or change backend code for the CVSU DTR system (NestJS modular monolith, TypeORM, PostgreSQL, Yarn 4 monorepo). Use when adding or editing a NestJS module, controller, DTO, use case, domain service, state machine, job, parser, PDF generator, or anything under apps/api or packages/shared. Also use when implementing attendance processing, imports, DTR generation/finalization, or API endpoints from API-DESIGN.md.
---

# CVSU DTR — Backend

The backend is **one NestJS app** (`apps/api`) started in two modes: HTTP API (`main.ts`) and worker (`worker.ts`, `WORKER=true`). It turns ZKTeco MB20 biometric exports into CSC Form No. 48 DTRs.

## Where the truth lives

Design docs live in `docs/` in the repo (or `CVSU-DTR/v3/` in the Obsidian vault). Each fact is owned by **one** doc — read the owner before guessing:

| Question | Owner doc |
|---|---|
| Is this in scope right now? | `PHASE1-MVP-1-MONTH.md` (current plan, deadline Oct 30 2026) |
| How is a day calculated / which status transitions exist? | `BUSINESS-RULES.md` |
| Module boundaries, public services | `MODULES.md` |
| Endpoint path, payload, error code, role matrix | `API-DESIGN.md` |
| Tables and constraints | `DATABASE-MAPPING.md` (see the `dtr-database` skill) |
| Patterns and anti-patterns | `DESIGN-PATTERNS.md` |
| Library choices and versions | `STACK.md` |

If code and doc disagree, stop and ask — don't silently "fix" the doc's decision in code. A changed decision goes into the README ADR log.

## Phase 1 scope guard

Phase 1 (Oct 5–30, 2026) is **HR-only**: export → import → generate → download. Before building anything, check `PHASE1-MVP-1-MONTH.md §2`:

- Only role used: `HR_ADMIN`. DTR statuses used: `DRAFT`, `FINALIZED` (plus `unlock` with reason).
- Schedules are assigned by HR as `APPROVED` (no approval workflow). Day remarks create `APPROVED` exceptions (no maker-checker yet).
- **No pg-boss, no Redis**: jobs run inline through `InlineJobQueue`, but still go through the `JobQueue` port so pg-boss drops in later.
- Use the **full v3 table names and columns** anyway, so later phases only add.

Never cut (even when behind): duplicate protection, append-only raw punches, calculation tests, backups.

## Module layout

Every non-trivial module under `apps/api/src/modules/<name>/`:

```
<name>.module.ts
api/              controllers + dto/          ← HTTP only: guards, DTO → use case, map result
application/      *.use-case.ts               ← workflow, transaction, scope check, audit
domain/           pure TS                     ← calculators, validators, state machine, errors
ports/            interfaces                  ← only at real boundaries
infrastructure/   entities/, typeorm-*.repository.ts, adapters
```

Small CRUD modules (departments, devices, calendar) may collapse `application` + `domain` into one service.

### Hard rules

1. **Domain imports nothing** from `@nestjs/*`, `typeorm`, `express`, `exceljs`, `puppeteer`, or `pg`. It must be unit-testable with plain Jest.
2. A module calls another module **only through its public service** (`MODULES.md §1`), never its repository or entities.
3. No dependency cycles; `forwardRef()` is not allowed without an ADR entry. `audit`, `files`, `jobs` are leaves.
4. `attendance-import` never writes `raw_attendance_records` directly — it calls `AttendanceService.ingest()`.
5. `dtr` never recalculates attendance — it reads `AttendanceService.processedFor()`.
6. No `process.env` inside modules — inject typed config from `@nestjs/config` (validated by a Zod/Joi schema at startup).
7. No JS `Date` arithmetic for local times. Use the `LocalDate` / `LocalTime` wrappers and the `Clock` / `BusinessCalendar` service (timezone `Asia/Manila`).
8. No `if (status === ...)` scattered in services — use the transition table helper.

## Controller → use case → domain

```ts
// api/dtrs.controller.ts — thin
@Controller('dtrs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DtrsController {
  constructor(private readonly finalizeDtr: FinalizeDtrUseCase) {}

  @Post(':id/finalize')
  @Roles('HR_ADMIN')
  @HttpCode(202)
  finalize(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch: string,
    @Actor() actor: ActorContext,            // from JWT, never from the body
  ) {
    return this.finalizeDtr.execute({ dtrId: id, expectedRowVersion: Number(ifMatch), actor });
  }
}
```

```ts
// application/finalize-dtr.use-case.ts — owns the transaction
@Injectable()
export class FinalizeDtrUseCase {
  constructor(
    private readonly dataSource: DataSource,
    private readonly dtrs: DtrRepository,
    private readonly scope: ScopePolicy,
    private readonly audit: AuditService,
    private readonly jobs: JobQueue,
  ) {}

  async execute(cmd: FinalizeDtrCommand) {
    const result = await this.dataSource.transaction(async (tx) => {
      const dtr = await this.dtrs.lockById(tx, cmd.dtrId);          // SELECT … FOR UPDATE
      if (!dtr) throw new DtrNotFoundError(cmd.dtrId);
      await this.scope.assertCanAccessEmployee(cmd.actor, dtr.employeeId); // out of scope → 404
      assertRowVersion(dtr, cmd.expectedRowVersion);                // → 409 CONCURRENT_MODIFICATION

      const to = dtrMachine.transition(dtr.status, 'finalize', {
        actorId: cmd.actor.userId, validatedBy: dtr.validatedBy, rules: await this.settings(),
      });
      await this.dtrs.snapshotItems(tx, dtr);                       // freeze dtr_items
      await this.dtrs.setStatus(tx, dtr, to, cmd.actor);           // + dtr_status_history
      await this.audit.record(tx, { actor: cmd.actor, action: 'DTR_FINALIZED',
        entityType: 'dtr', entityId: dtr.id, before: { status: dtr.status }, after: { status: to } });
      return dtr;
    });
    // Outside the transaction: never render PDFs or parse files inside one.
    const jobId = await this.jobs.enqueue('render-dtr-pdf', { dtrId: result.id }, { singletonKey: result.id });
    return { id: result.id, status: 'FINALIZED', document: { status: 'RENDERING', jobId } };
  }
}
```

Every state-changing use case: **state change + history + audit in one transaction**.

## State machines (transition table)

One generic helper in `packages/shared` or `common/state-machine.ts`, one table per aggregate (DTR, schedule, exception, import batch, period). Tables are in `BUSINESS-RULES.md §7–§9` and `DESIGN-PATTERNS.md §4`.

```ts
export interface Transition<S extends string, A extends string, C> {
  action: A; from: readonly S[]; to: S; guard?: (ctx: C) => boolean | string; // string = guard error code
}
export function makeMachine<S extends string, A extends string, C>(table: Transition<S, A, C>[]) {
  return {
    transition(from: S, action: A, ctx: C): S {
      const t = table.find((x) => x.action === action && x.from.includes(from));
      if (!t) throw new InvalidTransitionError(from, action);
      const g = t.guard?.(ctx);
      if (g === false || typeof g === 'string') throw new GuardFailedError(action, typeof g === 'string' ? g : undefined);
      return t.to;
    },
    allowedActions: (from: S) => table.filter((t) => t.from.includes(from)).map((t) => t.action),
  };
}
```

Role checks stay in the application layer; the table only knows states and guards.

## Errors

- Domain throws typed errors carrying a **stable code** from `API-DESIGN.md §9` (`DTR_INVALID_TRANSITION`, `MAKER_CHECKER_VIOLATION`, `SCHEDULE_OVERLAP`…). Codes live in `packages/shared` so the web app can switch on them.
- Domain code **never** throws `HttpException`. One global filter maps error class → HTTP status (400/401/403/404/409/413/422/429/500) and the envelope:

```json
{ "error": { "code": "…", "message": "…", "details": {}, "requestId": "req_…", "timestamp": "…" } }
```

- 500s return a generic message; stack traces go to logs only.

## API conventions (from API-DESIGN.md §1)

- Base `/api/v1`; plural kebab-case resources; transitions are `POST /<resource>/:id/<verb>`.
- JSON camelCase; known-empty values are `null`, not omitted.
- Dates `YYYY-MM-DD` (Manila business date); slot/schedule times `HH:mm`; instants ISO-8601 UTC.
- Success envelope `{ data }`; lists `{ data, meta: { page, limit, total, totalPages } }`; `limit ≤ 100`.
- Sorting only on a **per-endpoint whitelist** of fields.
- `Idempotency-Key` required on: import upload, commit, process-attendance, generate-dtrs, finalize. Same key within 24 h returns the original result.
- `If-Match` on DTR transitions and schedule updates → `409 CONCURRENT_MODIFICATION` on mismatch.
- Long operations return `202 { data: { jobId } }`; poll `GET /jobs/:id`.
- Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
- Every controller is decorated for `@nestjs/swagger`; the web client is generated from OpenAPI and CI fails on drift.

## Domain: attendance calculation

Implement `BUSINESS-RULES.md §3–§5` exactly. Pipeline (`DESIGN-PATTERNS.md §2`):

```
PunchNormalizer → SlotAssigner → ExceptionApplier → CalendarApplier → Strategy(FIXED|FLEXI) → StatusResolver
```

- Read every parameter from the `RuleSet` value object (grace, grace_mode, double_tap, noon_boundary, lunch_punch_required, undertime_column…). **Never hard-code** 08:00, 5 minutes, etc.
- Device in/out state column is **not trusted**; slots are assigned by time vs the noon boundary.
- Return a `trace: TraceStep[]` explaining every number (shown to HR, used by `/rule-sets/:id/simulate`).
- Processing is per **DTR period**, never per import file; deterministic and idempotent; skips dates locked by FINALIZED+ DTRs; stores `rule_set_id` and `input_fingerprint` per day.
- Take a PostgreSQL advisory lock per `dtr_period_id` while processing.
- Every row of `BUSINESS-RULES.md §10` must pass as a test (see the `dtr-testing` skill).

## Imports

```
store file (random key) → ParserRegistry.detect → parser.parse(stream) → RowSpec checks → staging + errors → preview → commit
```

- ExcelJS **streaming** reader and `csv-parse`. Never the npm `xlsx` package (CVEs, ADR-17).
- Device times have no zone: interpret as `Asia/Manila`, compute `punch_date` as the Manila local date.
- Row specs: RequiredColumns, NonEmptyIdentifier, ValidDateTime, NotInFuture, WithinSanityRange(±400 days), KnownDevice.
- Commit = `INSERT … SELECT … FROM staging ON CONFLICT DO NOTHING`, ~5,000 rows per chunk; `new_punches` = inserted count, `duplicate_punches` = the rest.
- File-hash match is a **warning only**; record-level dedup is the real guard.
- Upload limits and file safety: see the `dtr-security` skill.

## Jobs and PDF

- Use the `JobQueue` port. Queues: `import-validate`, `process-attendance`, `generate-dtrs`, `render-dtr-pdf`, `employee-import`, `report-export`, `maintenance`. Jobs are idempotent and keyed (`singletonKey = dtrPeriodId` for processing).
- DTR PDF = `templates/csc48/csc48.html` + CSS → Puppeteer `page.pdf()` behind the `DtrPdfGenerator` port. Fonts bundled locally, no network. Store SHA-256 and `template_version` in `dtr_documents`; footer prints DTR version + first 10 hex chars of the hash.

## Logging

`nestjs-pino`, JSON, request ID on every line. Redact `password`, `token`, `authorization`, `cookie`. Log IDs, not names or file contents.

## Commands (Yarn 4 only — never npm/pnpm)

```bash
corepack enable && yarn install                    # CI: yarn install --immutable
yarn workspace @cvsu-dtr/api add <pkg>
yarn workspace @cvsu-dtr/api dev
yarn workspace @cvsu-dtr/api migration:generate src/migrations/<NNNN_name>
yarn workspace @cvsu-dtr/api migration:run
yarn lint && yarn typecheck && yarn test
```

TypeScript is `strict` with `noUncheckedIndexedAccess`. Node 24 LTS.

## Before you call a backend change done

- [ ] Endpoint path, payload and error codes match `API-DESIGN.md`
- [ ] Controller is thin; logic is in a use case; math is in pure domain code
- [ ] Role guard **and** scope check (in the use case) — out of scope returns 404
- [ ] State changes use the transition table and write history + audit in the same transaction
- [ ] No transaction held across parsing, PDF rendering, or network calls
- [ ] Idempotency-Key / If-Match handled where required
- [ ] Domain unit tests + API test + permission tests (see `dtr-testing`)
- [ ] Migration added if the schema changed (see `dtr-database`)
- [ ] Security checklist items touched by this change (see `dtr-security`)
- [ ] `yarn lint && yarn typecheck && yarn test` green
