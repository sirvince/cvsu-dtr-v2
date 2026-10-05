---
name: dtr-testing
description: Write, run, or review tests for the CVSU DTR system — table-driven Jest tests for the attendance DayCalculator against the HR reference cases (BUSINESS-RULES §10), state-machine tests, MB20 parser fixture tests, Testcontainers PostgreSQL tests for constraints/triggers/dedup, Supertest API tests for auth, scope 404s, idempotency and error codes, Vitest + Testing Library for the web, and Playwright E2E for import → generate → finalize → download. Use when adding tests, fixing a failing test, checking coverage, or verifying a feature meets the Definition of Done or the Phase 1 acceptance tests.
---

# CVSU DTR — Testing

Correctness is the product: a DTR is a signed government form, and HR must see **zero** discrepancies against the signed test table. Owner docs: `BUSINESS-RULES.md §10` (cases), `DESIGN-PATTERNS.md §10` (by layer), `DEVELOPMENT-PHASES.md` (DoD), `PHASE1-MVP-1-MONTH.md §10` (acceptance). Repo `docs/` or vault `CVSU-DTR/v3/`.

## Test pyramid

| Layer | Tool | File pattern | What must be covered |
|---|---|---|---|
| Domain | Jest, table-driven | `src/**/domain/**/*.spec.ts` | Every `BUSINESS-RULES §10` row; state-machine tables; `ScheduleValidator`; rule-set resolution. **≥ 90% branch coverage** |
| Parser | Jest + fixture files | `src/**/infrastructure/**/*.spec.ts` | Anonymized real MB20 exports (xlsx + csv), malformed, missing columns, huge file, zip bomb, timezone |
| Repository / DB | Jest + **Testcontainers** PostgreSQL | `src/**/*.int-spec.ts` | EXCLUDE constraints, maker-checker CHECK, append-only trigger + grants, dedup `ON CONFLICT`, frozen `dtr_items` |
| API | Jest + **Supertest** against a Testcontainers DB | `test/**/*.e2e-spec.ts` | Auth, lockout, refresh reuse, role 403 / scope 404, transitions, idempotency, `If-Match`, error codes |
| Web | Vitest + Testing Library | `apps/web/src/**/*.test.tsx` | Formatters (`formatTime12h`, `formatMinutes`), forms (Zod), error-code handling, loading/empty/error states |
| E2E | Playwright | `e2e/**/*.spec.ts` | Import → process/generate → (validate) → finalize → download for one department |

Unit tests never touch the DB, the network, the filesystem (except parser fixtures), or the real clock.

## 1. DayCalculator — the reference table

The cases are encoded as data in [`references/day-calculator.cases.ts`](references/day-calculator.cases.ts). Copy it into `apps/api/src/modules/attendance/domain/__tests__/` and drive one `it.each` from it. **Do not edit expected values to make a test pass** — if you believe a value is wrong, it's a business-rule question for HR (`BUSINESS-RULES §11`); change the doc first.

```ts
import { FIXED_CASES, GRACE_CASES, FLEXI_CASES, DayCase } from './day-calculator.cases';
import { DayCalculator } from '../day-calculator';
import { buildInput } from './build-input';   // maps a DayCase → DayInput (RS-TEST + STD schedule + overrides)

const calc = DayCalculator.withDefaultStrategies();

describe.each([
  ['FIXED (§10)', FIXED_CASES],
  ['Grace variants', GRACE_CASES],
  ['FLEXI', FLEXI_CASES],
])('DayCalculator — %s', (_label, cases) => {
  it.each(cases.map((c) => [`${c.id} ${c.title}`, c] as const))('%s', (_name, c: DayCase) => {
    const r = calc.calculate(buildInput(c));
    const e = c.expect;
    const t = (x?: { toString(): string }) => (x ? x.toString().slice(0, 5) : null); // LocalTime → 'HH:mm'

    if (e.amIn !== undefined)   expect(t(r.slots.amIn)).toBe(e.amIn);
    if (e.amOut !== undefined)  expect(t(r.slots.amOut)).toBe(e.amOut);
    if (e.pmIn !== undefined)   expect(t(r.slots.pmIn)).toBe(e.pmIn);
    if (e.pmOut !== undefined)  expect(t(r.slots.pmOut)).toBe(e.pmOut);
    if (e.tardy !== undefined)     expect(r.tardyMinutes).toBe(e.tardy);
    if (e.earlyOut !== undefined)  expect(r.earlyOutMinutes).toBe(e.earlyOut);
    if (e.undertime !== undefined) expect(r.undertimeMinutes).toBe(e.undertime);
    if (e.worked !== undefined)    expect(r.workedMinutes).toBe(e.worked);
    if (e.status)                  expect(r.status).toBe(e.status);
    if (e.flags)                   expect(r.flags).toEqual(expect.arrayContaining(e.flags));
    if (e.isBlocking !== undefined) expect(r.isBlocking).toBe(e.isBlocking);
    if (e.slotSources)             expect(r.slotSources).toMatchObject(e.slotSources);
    if (e.ignoredPunches) {
      const usedTimes = r.usedPunchIds.map((id) => c.punches[Number(id)]); // buildInput uses index as id
      e.ignoredPunches.forEach((p) => expect(usedTimes).not.toContain(p));
    }
    expect(r.trace.length).toBeGreaterThan(0);  // every result must be explainable
  });
});
```

Also test, beyond the table:
- **Determinism**: same input twice → deep-equal result (and same `input_fingerprint`).
- **Seconds truncation**: `08:00:59` is not late (Q12).
- **Device state column ignored**: swapping in/out states doesn't change slots.
- **Punch outside window** → `PUNCH_OUTSIDE_WINDOW` flag, punch ignored but returned.
- **Rule parameters, not constants**: change `noon_boundary`, `double_tap_minutes`, `undertime_column = EARLY_OUT_ONLY`, `half_day_absence_as = UNDERTIME`, `lunch_punch_required = true` and assert the effect.
- **Timezone**: a punch at `2026-10-05T16:30:00Z` belongs to Manila date `2026-10-06`.

Phase 1 must pass `PHASE1_REQUIRED` (T01–T10, T13, T16) by the end of week 3; add T11/T14 when day remarks ship.

## 2. State machines

Test the transition **table**, exhaustively: for every `(status, action)` pair, either the expected target or `InvalidTransitionError`.

```ts
const ALL: DtrStatus[] = ['DRAFT','FOR_REVIEW','VALIDATED','RETURNED','FINALIZED','SUBMITTED','RECEIVED'];
const ACTIONS = ['submitForReview','validate','return','finalize','markSubmitted','receive','rejectSubmission','reopen'] as const;
const ALLOWED: Record<string, DtrStatus> = {
  'DRAFT:submitForReview': 'FOR_REVIEW', 'RETURNED:submitForReview': 'FOR_REVIEW',
  'FOR_REVIEW:validate': 'VALIDATED', 'FOR_REVIEW:return': 'RETURNED', 'VALIDATED:return': 'RETURNED',
  'VALIDATED:finalize': 'FINALIZED', 'FINALIZED:markSubmitted': 'SUBMITTED',
  'FINALIZED:receive': 'RECEIVED', 'SUBMITTED:receive': 'RECEIVED', 'SUBMITTED:rejectSubmission': 'FINALIZED',
  'FINALIZED:reopen': 'DRAFT', 'SUBMITTED:reopen': 'DRAFT', 'RECEIVED:reopen': 'DRAFT',
};
it.each(ALL.flatMap((s) => ACTIONS.map((a) => [s, a] as const)))('%s --%s-->', (s, a) => {
  const key = `${s}:${a}`;
  const ctx = okContext();                       // reason present, validator ≠ finalizer, 0 blocking
  if (key in ALLOWED) expect(dtrMachine.transition(s, a, ctx)).toBe(ALLOWED[key]);
  else expect(() => dtrMachine.transition(s, a, ctx)).toThrow(InvalidTransitionError);
});
```
Then guards: `validate` with blocking flags → fails; `return`/`reopen`/`rejectSubmission` without reason → fails; `finalize` by the validator with `twoPersonFinalize` → fails. Do the same for schedule, exception, import batch and period tables (`BUSINESS-RULES §8–§9`). Phase 1 uses only `DRAFT ↔ FINALIZED` (finalize / unlock) — test that subset at the use-case level too.

## 3. Parsers

- Fixtures in `apps/api/test/fixtures/mb20/` — **anonymized** real exports only (replace names; keep ID/time structure). Never commit personal data.
- Cases: valid xlsx, valid csv, two overlapping exports, missing column → `IMPORT_MISSING_COLUMNS`, bad date/time rows → row-level errors with row numbers, empty identifier, future date, ±400-day sanity range, `.xlsm` / renamed `.exe` → rejected by magic bytes, > 20 MB → `IMPORT_TOO_LARGE`, > 200k rows, zip bomb (small file, huge uncompressed size) → rejected before parsing.
- Assert times are interpreted as `Asia/Manila` and `punch_date` is the Manila date.
- Assert streaming: parsing the large fixture keeps heap growth bounded (rough check, not a micro-benchmark).

## 4. Database (Testcontainers)

Start one `postgres:17` container per test run (global setup), run **all migrations** as `migrator`, connect tests as `app_user`, and wrap each test in a transaction that rolls back (or truncate non-append-only tables between tests).

Must-have constraint tests:

| Test | Expect |
|---|---|
| Insert same `(device_id, biometric_identifier, punched_at)` twice via `ON CONFLICT DO NOTHING` | 1 row; second `rowCount = 0` |
| `UPDATE` / `DELETE` on `raw_attendance_records` as `app_user` | Permission denied (grant) |
| Same as owner role | Trigger raises `… is append-only` |
| `UPDATE` / `DELETE` on `audit_logs` as `app_user` | Permission denied |
| Overlapping `employee_biometric_ids` ranges for same device + ID | Exclusion violation (`23P01`) |
| Overlapping `dtr_periods` | `23P01` |
| Two APPROVED schedules overlapping for one employee | `23P01`; DRAFT overlaps allowed |
| Exception with `reviewed_by = requested_by` | Check violation (`23514`) |
| Write to `dtr_items` when DTR is FINALIZED | Trigger error |
| Update `config` of a PUBLISHED rule set | Trigger error |
| Second DTR for same employee + period | Unique violation (`23505`) |

Plus repository behaviour: import commit counts (`new_punches` / `duplicate_punches`) on overlapping files; `v_unmatched_identifiers` respects `valid_from/valid_to`; processing upsert skips FINALIZED dates.

## 5. API (Supertest)

Boot the real `AppModule` against the Testcontainers DB with `FixedClock` and `InlineJobQueue`. Seed users per role with helpers (`loginAs('HR_STAFF', { scopes: [deptA] })`).

Every endpoint gets a **permission matrix** test (DoD: "allowed role ✓, other role 403/404"):

```ts
describe('GET /api/v1/dtrs/:id', () => {
  it('HR_ADMIN → 200', ...);
  it('HR_STAFF in scope → 200 and audits DTR_VIEWED', ...);
  it('HR_STAFF out of scope → 404 (not 403)', ...);
  it('EMPLOYEE → 403 on /dtrs (uses /me/dtrs instead)', ...);
  it('SYSTEM_ADMIN → 403', ...);
  it('no token → 401', ...);
});
```

Also cover:
- Auth: login, generic error for unknown email vs wrong password, **5 failures → locked** (A1), refresh rotation, **reuse of an old refresh token revokes the family**, logout clears cookie, cookie flags (`HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`), `forgot` always 204.
- `/me/*` ignores any `employeeId` in path/body.
- Idempotency: same `Idempotency-Key` twice → same response, one side effect; missing key → `IDEMPOTENCY_KEY_REQUIRED`.
- `If-Match` mismatch → `409 CONCURRENT_MODIFICATION`.
- Error envelope shape (`error.code`, `requestId`, no stack trace) for 400/404/409/422/500.
- Pagination `limit > 100` rejected/clamped; unknown sort field rejected.
- Downloads: `Content-Disposition: attachment`, `Cache-Control: no-store`; audit row written.
- Exports: a cell `=HYPERLINK(...)` comes out escaped.

## 6. Web (Vitest)

- Pure helpers: `formatTime12h('13:05') → '1:05 PM'`, `formatMinutes(95) → '1h 35m'`.
- Components render loading / empty / error states; error messages switch on `error.code` from `packages/shared`.
- Auth client: on 401 calls `/auth/refresh` **once**, retries, then logs out; access token never in `localStorage`.
- Mock the generated `api-client`, not `fetch`.

## 7. E2E (Playwright)

One happy-path spec per critical flow against `docker compose` (api + web + postgres) with seeded synthetic data:

Phase 1: log in → import employee CSV → upload MB20 export → link unmatched ID → commit → upload same file again (0 new) → generate DTRs for one department → open DTR detail → finalize → try regenerate (blocked) → unlock with reason → finalize → download PDF and department ZIP.

## Phase 1 acceptance (Oct 30, with HR) → automated coverage

| # | Acceptance | Automate as |
|---|---|---|
| A1 | 5 wrong passwords lock the account | API test |
| A2 | Employee CSV with 2 bad rows: good rows saved, 2 errors listed | API + parser test |
| A3 | MB20 October export: correct date range, counts, unmatched IDs | Parser + API test with fixture |
| A4 | Link unmatched IDs, commit → unmatched = 0 | API test |
| A5 | Same file again → "0 new punches, N already imported" | DB + API test |
| A6 | Non-Excel / corrupted file rejected clearly | Parser + API test |
| A7 | Generate for a department: 1 DTR per employee; no-schedule flagged | API test |
| A8 | 10 DTRs match manual computation | Domain table + HR spot-check (manual) |
| A9 | Holiday shown as holiday, not absent | Domain T09 + API test |
| A10 | Finalized DTR can't be regenerated; unlock needs reason | API + DB trigger test |
| A11 | PDF + ZIP open; PDF matches Form 48 when printed | E2E download + **manual print test** |
| A12 | Restart: data intact, today's backup exists | Ops smoke test (manual / script) |

## Conventions

- `FixedClock` (`Asia/Manila`) in every test that touches "today"; never `new Date()` in assertions.
- Test data builders (`anEmployee().inDept(d).withBiometric('123')`) over large JSON fixtures.
- Test names cite the rule: `it('T04 Late PM + early out', …)`, `it('MAKER_CHECKER_VIOLATION when approver = requester', …)`.
- No `.only`, no skipped tests without an issue link, no snapshot tests for calculated numbers (assert values explicitly).
- A bug fix starts with a failing test that reproduces it.

## Commands

```bash
yarn workspace @cvsu-dtr/api test                       # unit (domain, parsers)
yarn workspace @cvsu-dtr/api test --coverage            # check domain branch coverage ≥ 90%
yarn workspace @cvsu-dtr/api test:int                   # Testcontainers (Docker must be running)
yarn workspace @cvsu-dtr/api test:e2e                   # Supertest API suite
yarn workspace @cvsu-dtr/web test                       # Vitest
yarn playwright test                                    # E2E
yarn test                                               # all workspaces (CI)
```

If these scripts don't exist yet, add them to `apps/api/package.json` with separate Jest configs (`testRegex` for `.spec.ts`, `.int-spec.ts`, `.e2e-spec.ts`) and set `coverageThreshold` for `src/**/domain/**` to `{ branches: 90 }`.

## Definition of Done (testing part)

- [ ] Unit tests for new domain logic; the §10 table still fully green
- [ ] API test for each new/changed endpoint, including the permission matrix (✓ / 403 / 404)
- [ ] DB test for any new constraint, trigger, or grant
- [ ] E2E updated if a critical flow changed
- [ ] Domain branch coverage ≥ 90%; CI green (`lint`, `typecheck`, tests, build)
