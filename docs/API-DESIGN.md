---
title: CVSU DTR — REST API Design
version: 3.0
status: draft
updated: 2026-10-05
base_url: /api/v1
---

# CVSU DTR — REST API Design

Related: [[CVSU-DTR/v3/MODULES|MODULES]] · [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] · [[CVSU-DTR/v3/SECURITY-PRIVACY|SECURITY-PRIVACY]]

> This document is the **single source** for endpoint paths. OpenAPI (`/api/docs`, non-production only) is generated from the NestJS controllers and must match it.

> [!info] What changed in v3
> Source: [[CVSU-DTR/HR-Requirements-Analysis|HR-Requirements-Analysis]] (ADR-21 … ADR-32 in [[CVSU-DTR/v3/README|README]] §2). All changes are **additive** and stay in `/api/v1` (§10).
> - **Semi-monthly periods** (ADR-21): `periodHalf`, `plannedAdvanceDate`, and a helper that creates both halves of a month (§5.4).
> - **Advance processing** (ADR-22, ADR-23): `processingType: ADVANCE` + `processedUntil` on `process-attendance`, processing runs, and read endpoints for advance credits and their history (§5.7, §5.12).
> - **Reconciliation** (ADR-24, ADR-25): automatic on import commit, for the batch's date range and device. The commit response gains a reconciliation summary with a suspected-data-gap warning. HR_ADMIN gets a manual re-run (§5.6, §5.12).
> - **Carry-forward adjustments** (ADR-25): a list per employee/period, a `MANUAL` entry for HR_ADMIN, and the DTR's prior-period adjustment lines, all from `carry_forward_adjustments` (§5.12).
> - **New exception types and two-level approval** (ADR-27, ADR-28, ADR-31): `ASYNCHRONOUS`, `OFFSET`, `WELLNESS`, `MAKE_UP_CLASS`; a new `endorse` action; the make-up payload (§5.8, §6).
> - **Offset and wellness balances** (ADR-29, ADR-30): earned-offset requests, offset balance per semester, wellness days left per academic year (§5.13).
> - **Schedules** get `endorse` before `approve` (§5.5). **Calendar** gets `GOVERNMENT_ANNOUNCEMENT` (§5.4).
> - **DTR read/print** shows advance-credit and prior-period-adjustment totals, the per-day `attendanceBasis`, and adjustment lines (§5.9, §6).
> - Updated role matrix (§4), job types (§7) and error codes (§9).
>
> **Phase tags** used in v3 additions (from the analysis §8.5):
> - **[P1]**: in the Phase 1 MVP (Oct 30).
> - **[P1+]**: can ship right after Oct 30, but must be live **before the second cutoff after go-live**.
> - **[P1B]**: Phase 1B (needs Department Head and employee logins).
>
> Untagged endpoints keep their v2 phasing ([[CVSU-DTR/v3/PHASE1-MVP-1-MONTH|PHASE1-MVP]] §5 lists the Phase 1 subset).

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Base | `https://<host>/api/v1` |
| Resources | Plural kebab-case nouns: `/attendance-imports`, `/dtr-periods`, `/dtrs` |
| State transitions | `POST /<resource>/:id/<action>` with a verb, e.g. `/dtrs/:id/finalize` |
| JSON | camelCase fields; `null` rather than omitted for known-empty values |
| Dates | `YYYY-MM-DD` (business date, Asia/Manila) |
| Times (slots, schedules) | `HH:mm` 24-hour local. The UI formats them as 12-hour. |
| Instants | ISO-8601 UTC, `2026-10-05T00:15:00.000Z` |
| Success envelope | `{ "data": … }` and, for lists, `{ "data": [...], "meta": { page, limit, total, totalPages } }` |
| Pagination | `?page=1&limit=20`; `limit ≤ 100` (enforced) |
| Sorting | `?sort=lastName&order=asc`, using a whitelist per endpoint |
| Filtering | Plain query params (`?dtrPeriodId=…&status=FOR_REVIEW&departmentId=…`) |
| Search | `?q=` on name / employee number |
| Request ID | `X-Request-Id` accepted or generated, and echoed in responses and errors |
| Idempotency | `Idempotency-Key` header **required** on `POST /attendance-imports`, `/…/commit`, `/…/process-attendance` (including ADVANCE runs), `/…/generate-dtrs`, `/dtrs/:id/finalize`, `/dtr-periods/:id/reconcile`, `/dtr-periods/month`, `POST /carry-forward-adjustments` |
| Concurrency | `If-Match: <version>` on DTR transitions and schedule updates. A mismatch returns `409 CONCURRENT_MODIFICATION`. |
| Async | Long operations return `202 { data: { jobId } }`, then poll `GET /jobs/:id` |

---

## 2. Authentication

| Endpoint | Notes |
|---|---|
| `POST /auth/login` | `{ email, password }` → `{ accessToken, expiresIn, user }` and sets the `refresh_token` cookie (httpOnly, Secure, SameSite=Strict, Path=/api/v1/auth) |
| `POST /auth/refresh` | Uses the cookie; rotates the refresh token; reuse of an old token revokes the whole family |
| `POST /auth/logout` | Revokes the current refresh token and clears the cookie |
| `POST /auth/logout-all` | Revokes all of the user's refresh tokens |
| `GET /auth/me` | `{ id, email, roles[], employee?: { id, name, departmentId }, scopes: departmentIds[] }` |
| `POST /auth/change-password` | `{ currentPassword, newPassword }` |
| `POST /auth/password/forgot` | Always returns `204`, so it doesn't reveal whether an account exists |
| `POST /auth/password/reset` | `{ token, newPassword }`; also used to accept an invitation |

Access token: JWT, 15 min, sent as `Authorization: Bearer`. The web app keeps it **in memory only**. Login is rate-limited (SECURITY-PRIVACY §2).

---

## 3. Scope and ownership

Every protected request passes through:

```
JwtAuthGuard → RolesGuard (@Roles) → use case: ScopePolicy.assert(actor, resource)
```

| Actor | Scope |
|---|---|
| EMPLOYEE | Own employee record only (resolved from the token, **never** from a path param) |
| DEPARTMENT_HEAD | Employees in `user_department_scopes` |
| HR_STAFF | Employees in `user_department_scopes` (or all, if configured "global HR staff") |
| HR_ADMIN | All employees |
| SYSTEM_ADMIN | No attendance/DTR data access beyond the audit log |

A resource out of scope returns **`404`**, not `403`, so its existence isn't leaked.

**v3:** a **Dean** has no separate role. A Dean is a `DEPARTMENT_HEAD` whose `user_department_scopes` cover every department of the college. Endorsing and Head-level approvals (ADR-28) use the same scope check as above.

---

## 4. Roles and permissions

✓ = allowed · S = allowed within scope · O = own records only · — = denied

| Capability | EMPLOYEE | DEPT_HEAD | HR_STAFF | HR_ADMIN | SYS_ADMIN |
|---|---|---|---|---|---|
| Manage users, roles, scopes | — | — | — | — | ✓ |
| Manage departments, devices | — | — | — | ✓ | ✓ |
| Manage employees & biometric mapping | — | — | S | ✓ | — |
| Manage academic years / semesters / DTR periods | — | — | — | ✓ | — |
| Open / close / reopen DTR period | — | — | — | ✓ | — |
| Manage calendar events (incl. `GOVERNMENT_ANNOUNCEMENT`, v3) | — | — | — | ✓ | — |
| Manage & publish rule sets | — | — | — | ✓ | — |
| Submit own schedule | O | O | O | O | — |
| ~~Approve / reject schedules~~ (v2 row, split in v3 into the two rows below) | — | S | S | ✓ | — |
| **v3** Endorse / reject schedule, level 1 (≠ submitter) [P1B] | — | S | — | — | — |
| **v3** Approve / reject endorsed schedule, level 2 (≠ submitter) [P1B] | — | — | S | ✓ | — |
| Create schedule directly (pre-approved) | — | — | S | ✓ | — |
| Upload / validate / commit imports (commit also triggers reconciliation, v3) | — | — | ✓ | ✓ | — |
| Run attendance processing (FULL **or ADVANCE**, v3) | — | — | S | ✓ | — |
| **v3** View processing runs, advance credits and their history | — | — | S | ✓ | — |
| **v3** Re-run reconciliation manually [P1+] | — | — | — | ✓ | — |
| **v3** View carry-forward adjustments (per employee / period) [P1+] | — | — | S | ✓ | — |
| **v3** Create a `MANUAL` carry-forward adjustment [P1+] | — | — | — | ✓ | — |
| View attendance | O | S | S | ✓ | — |
| Request exception / correction | O (Phase 2) | S | S | ✓ | — |
| **v3** Record `ASYNCHRONOUS` (auto-approved, whole day) [P1] | — | — | S | ✓ | — |
| **v3** Request `OFFSET` / `WELLNESS` / `MAKE_UP_CLASS` [P1B] ⚠ | O | O | S (on behalf) | ✓ (on behalf) | — |
| **v3** Endorse / reject `OFFSET`, `WELLNESS` (level 1, ≠ requester) [P1B] | — | S | — | — | — |
| **v3** Approve / reject `MAKE_UP_CLASS` (Head only, ≠ requester) [P1B] | — | S | — | — | — |
| Approve / reject exception (≠ requester); for `OFFSET`/`WELLNESS` only after endorsement (v3) | — | — | — | ✓ | — |
| **v3** Request earned offset hours [P1B] | O | O | S (on behalf) | ✓ (on behalf) | — |
| **v3** Approve / reject earned offset hours (Head/Dean, ≠ requester) [P1B] | — | S | — | — | — |
| **v3** View offset balance / wellness days left [P1B] | O | S | S | ✓ | — |
| Generate DTRs | — | — | S | ✓ | — |
| Submit own DTR for review | O | O | O | O | — |
| Validate / return DTR | — | — | S | ✓ | — |
| Finalize DTR (≠ validator) | — | — | — | ✓ | — |
| Reopen DTR | — | — | — | ✓ | — |
| Download DTR PDF | O | S | S | ✓ | — |
| Mark own DTR submitted | O | O | O | O | — |
| Receive / reject physical submission | — | — | S | ✓ | — |
| Reports | — | S | S | ✓ | — |
| Audit log | — | — | — | ✓ (business events) | ✓ |

Users hold several roles. For example, a department head is `EMPLOYEE + DEPARTMENT_HEAD` and gets the union of both.

**v3 approval levels** (ADR-28). Who acts at each level is fixed per type; the rules themselves are in [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] §6 (schedules) and §8 (exceptions):

| Item | Level 1: endorse (`DEPARTMENT_HEAD`, in scope) | Level 2: approve | Statuses |
|---|---|---|---|
| `OFFSET`, `WELLNESS` | ✓ `PENDING → ENDORSED` | `HR_ADMIN`: `ENDORSED → APPROVED` | `PENDING, ENDORSED, APPROVED, REJECTED, CANCELLED, REVOKED` |
| `MAKE_UP_CLASS` | — (one level) | `DEPARTMENT_HEAD`: `PENDING → APPROVED` | same |
| `ASYNCHRONOUS` | — | none: HR creates it as `APPROVED`, `autoApproved = true` | same |
| Other v2 types (`LEAVE`, `OFFICIAL_BUSINESS`, …) | — (unchanged) | `HR_ADMIN`: `PENDING → APPROVED` | same |
| Schedule change | ✓ `SUBMITTED → ENDORSED` | `HR_STAFF` (scope) / `HR_ADMIN`: `ENDORSED → APPROVED` | `DRAFT, SUBMITTED, ENDORSED, APPROVED, REJECTED, SUPERSEDED` |
| Earned offset hours | — (one level) | `DEPARTMENT_HEAD`: `PENDING → APPROVED` | `PENDING, APPROVED, REJECTED, CANCELLED` |

- **Maker-checker** at every level: the endorser ≠ requester and the approver ≠ requester (`MAKER_CHECKER_VIOLATION`, `details.level = ENDORSE | APPROVE`).
- **Reject** is allowed at either level. The server records `rejectedLevel` (`DEPARTMENT` or `HR`) from the current status.
- ⚠ Assumption: employees file `OFFSET`, `WELLNESS` and `MAKE_UP_CLASS` themselves from Phase 1B, because a two-level flow needs employee and Head logins. Other exception types stay HR-filed until Phase 2, as in v2.
- ⚠ Open: v2 BUSINESS-RULES §6 says "HR approves if no Department Head is configured". For two-level items the API assumes the request **waits in `PENDING`** until HR_ADMIN assigns a `DEPARTMENT_HEAD` scope, so one HR person never acts at both levels. BUSINESS-RULES §6/§8 decides.

---

## 5. Endpoint catalogue

### 5.1 Self-service (`/me`)
```
GET    /me                                   profile + employee + current period summary
GET    /me/schedules                         ?semesterId
POST   /me/schedules                         create DRAFT (from template or blocks)
PATCH  /me/schedules/:id                     only DRAFT / REJECTED
POST   /me/schedules/:id/submit              DRAFT → SUBMITTED
GET    /me/attendance                        ?dtrPeriodId | ?dateFrom&dateTo
GET    /me/attendance-exceptions             (Phase 2: POST to request)
POST   /me/attendance-exceptions             v3 [P1B]: OFFSET | WELLNESS | MAKE_UP_CLASS only (other types Phase 2)
GET    /me/offset-balance                    v3 [P1B] ?semesterId   (same shape as §5.13)
GET    /me/offset-earning-requests           v3 [P1B]
POST   /me/offset-earning-requests           v3 [P1B] (payload §6)
GET    /me/wellness-balance                  v3 [P1B] ?academicYearId
GET    /me/dtrs                              ?dtrPeriodId&status
GET    /me/dtrs/:id                          includes items + history
POST   /me/dtrs/:id/submit-for-review        DRAFT/RETURNED → FOR_REVIEW  { remarks? }
POST   /me/dtrs/:id/mark-submitted           FINALIZED → SUBMITTED
GET    /me/dtrs/:id/pdf                      FINALIZED+ only; audit DTR_DOWNLOADED
```

### 5.2 Users and access (SYSTEM_ADMIN)
```
GET    /users            POST /users (invite)         GET/PATCH /users/:id
POST   /users/:id/deactivate     POST /users/:id/unlock
PUT    /users/:id/roles          { roles: [...] }
PUT    /users/:id/department-scopes   { departmentIds: [...] }
```

### 5.3 Organization
```
GET/POST        /departments            GET/PATCH /departments/:id    POST /departments/:id/deactivate
GET/POST        /biometric-devices      GET/PATCH /biometric-devices/:id
GET/POST        /employees              GET/PATCH /employees/:id      POST /employees/:id/deactivate
POST            /employees/import       multipart CSV → 202 job (validated like attendance imports)
GET/POST        /employees/:id/biometric-ids
PATCH           /employees/:id/biometric-ids/:mappingId     (set valid_to)
GET             /biometric-ids/unmatched                    ?deviceId  (v_unmatched_identifiers)
```

### 5.4 Academic calendar
```
GET/POST   /academic-years        GET/PATCH /academic-years/:id
GET/POST   /academic-years/:id/semesters     GET/PATCH /semesters/:id
GET/POST   /dtr-periods           GET/PATCH /dtr-periods/:id
POST       /dtr-periods/:id/open | /close | /reopen   { reason? }
POST       /dtr-periods/month     v3 [P1] { year, month, semesterId, plannedAdvanceDates?: { first?, second? } }
                                  → 201 { data: [half 1, half 2] }   (both halves, status DRAFT)
GET/POST   /calendar-events       ?from&to&type     GET/PATCH/DELETE /calendar-events/:id
```
Changing a calendar event marks the affected processed days as stale.

**v3: semi-monthly periods [P1]** (ADR-21). A DTR period is one half of a month.
- `POST /dtr-periods` and `PATCH /dtr-periods/:id` accept `periodHalf` (`1` = days 1–15, `2` = 16 to month end) and an optional `plannedAdvanceDate`. The server derives `startDate`/`endDate` from `year`, `month` and `periodHalf`. A range that doesn't match the half returns `PERIOD_INVALID_HALF`.
- `POST /dtr-periods/month` creates both halves in one transaction. If either half would overlap an existing period, nothing is created (`PERIOD_OVERLAP`).
- `plannedAdvanceDate` is only a planning hint for HR (the "cutoff" in the HR document). It must satisfy `startDate ≤ plannedAdvanceDate < endDate` (`ADVANCE_DATE_OUT_OF_PERIOD`). The actual cut is the `processedUntil` of an ADVANCE run (§5.7).
- `GET /dtr-periods` returns `periodHalf`, `plannedAdvanceDate`, and an `advance` summary: `{ lastProcessedUntil, openCredits }` (`null` if no ADVANCE run yet).

**v3: government announcements [P1]** (ADR-27). `type = GOVERNMENT_ANNOUNCEMENT` is a calendar event, not an exception:
- `scope` must be `ALL` (`CALENDAR_SCOPE_NOT_ALLOWED` otherwise).
- `startTime`/`endTime` are optional. If they are empty, the announcement covers the whole day; if set, it is partial-day.
- `reference` holds the memo or proclamation number. Payload: §6.

### 5.5 Schedules
```
GET    /schedule-templates          POST/PATCH (HR_ADMIN)
GET    /schedules                   ?status=SUBMITTED&departmentId&semesterId   (approval queue)
GET    /employees/:id/schedules
POST   /employees/:id/schedules     HR creates (optionally pre-approved)
GET    /schedules/:id
POST   /schedules/:id/endorse       v3 [P1B] DEPARTMENT_HEAD: SUBMITTED → ENDORSED  { remarks? }
POST   /schedules/:id/approve       SUBMITTED → APPROVED (supersedes previous)
                                    v3: ENDORSED → APPROVED (HR); SUBMITTED → approve returns ENDORSEMENT_REQUIRED
POST   /schedules/:id/reject        { reason }   v3: from SUBMITTED (Head) or ENDORSED (HR)
```
**v3 two-level schedule approval [P1B]** (ADR-28, D-HR-21). The approval queue filters by level: `?status=SUBMITTED` is the Head's queue, `?status=ENDORSED` is HR's queue. `GET /schedules/:id` returns `endorsedBy`, `endorsedAt` and `rejectedLevel`. `If-Match` is required on `endorse`, `approve` and `reject`. HR-created pre-approved schedules (Phase 1 `POST /schedules/assign`) skip both levels and are audited, as in v2. ⚠ The effective date of a mid-semester change is still open (analysis §8.7 O-3).

### 5.6 Attendance imports
```
POST   /attendance-imports                  multipart: file, deviceId → 201 { id, status: UPLOADED }
POST   /attendance-imports/:id/validate     → 202 job; result: VALIDATED | REJECTED
GET    /attendance-imports                  ?status&deviceId&from&to
GET    /attendance-imports/:id              summary counts, detected date range, duplicate-file warning
GET    /attendance-imports/:id/errors       ?errorCode&page
GET    /attendance-imports/:id/preview      ?page  (staged rows)
POST   /attendance-imports/:id/commit       VALIDATED → COMMITTED; returns { newPunches, duplicatePunches }
                                            v3 [P1+]: + reconciliation summary (below)
POST   /attendance-imports/:id/discard      → DISCARDED
```
Validation can run automatically right after upload. The UI shows "Upload & Validate" as one step.

**v3: reconciliation on commit [P1+]** (ADR-24, ADR-25). Committing an import starts reconciliation automatically. There is no separate call.
- It covers the credits whose `creditDate` falls **inside the batch's detected range** (`detectedDateFrom ≤ creditDate ≤ detectedDateTo`), and only for employees mapped to the **batch's device** (ADR-24). It also covers make-up classes whose make-up date is in that range (ADR-31).
- This includes `ADVANCED` credits **and** credits that were already reconciled. A later import that brings punches for a reversed or adjusted date **re-evaluates** the credit and can restore it (event `RESTORED`/`ADJUSTED`). This is how HR recovers from a missing export.
- The rules (present → `RECONCILED`, late → `ADJUSTED`, no punches → `REVERSED`) are owned by [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] §12. The API only reports the result.
- **Phase 1** (inline jobs): reconciliation finishes before the response, so `reconciliation.status = SUCCEEDED`.
- **Phase 1B** (pg-boss): the response can return `status = QUEUED` with a `jobId`. The same summary then appears on `GET /attendance-imports/:id` and on the processing run.
- The punches stay committed **even if reconciliation fails**. In that case the response has `reconciliation.status = FAILED`, and HR_ADMIN re-runs it with `POST /dtr-periods/:id/reconcile` (§5.12).

```json
{
  "data": {
    "id": "uuid", "status": "COMMITTED",
    "newPunches": 18240, "duplicatePunches": 3115,
    "reconciliation": {
      "status": "SUCCEEDED",
      "processingRunIds": ["uuid"],
      "creditsChecked": 1980,
      "reconciled": 1650, "adjusted": 188, "reversed": 142, "restored": 0, "stillAdvanced": 0,
      "adjustmentMinutesTotal": -91230,
      "carryForwardAdjustmentsCreated": 330,
      "appliedInDtrPeriodId": "uuid",
      "makeupOutcomes": { "attended": 3, "partial": 1, "notAttended": 0 },
      "byDate": [
        { "date": "2026-10-14", "reconciled": 830, "adjusted": 95, "reversed": 65 },
        { "date": "2026-10-15", "reconciled": 820, "adjusted": 93, "reversed": 77 }
      ],
      "suspectedDataGaps": [
        { "date": "2026-10-15", "absentRatio": 0.62, "reversed": 77,
          "deviceIds": ["uuid"], "message": "62% of credited employees have no punches on 2026-10-15." }
      ]
    }
  }
}
```
- `suspectedDataGaps` lists dates where more than the configured share of credited employees (default **50%**) have no punches (analysis §8.2). It is a **warning**: the reversals are still applied, because "no data = absent" (ADR-24). HR checks the device export and imports the missing file; that commit re-evaluates and restores the affected credits automatically. The manual re-run (§5.12) is only a fallback. ⚠ Assumption: the threshold is a setting, not a rule-set value.
- The UI shows `reversed` and `byDate` as the **reversal summary** ("142 credits reversed for Oct 15").

### 5.7 Attendance and processing
```
POST   /dtr-periods/:id/process-attendance  { employeeIds?, departmentId?, onlyStale?: true } → 202 { jobId }
GET    /jobs/:id                            { status, progress: { total, done }, summary, error }
GET    /attendance                          ?dtrPeriodId&departmentId&employeeId&status&blocking=true
GET    /attendance/:id                      processed day + used/ignored raw punches + exceptions applied
GET    /employees/:id/raw-punches           ?from&to   (HR; audit-logged read)
                                            v3 [P1B]: also DEPARTMENT_HEAD in scope, to verify earned offset (§5.13)
GET    /dtr-periods/:id/attention           counts: blocking days, no-schedule employees, unmatched IDs, pending exceptions
                                            v3: + openAdvanceCredits, pendingEndorsements, suspectedDataGaps
GET    /dtr-periods/:id/processing-runs     v3 [P1] ?processingType=FULL|ADVANCE|RECONCILIATION
GET    /processing-runs/:id                 v3 [P1] one processing_jobs row: type, processedUntil, scope, status, summary
```

**v3: advance processing [P1]** (ADR-22, ADR-23). An advance run is a normal processing run with two extra fields:

```http
POST /api/v1/dtr-periods/:id/process-attendance
Idempotency-Key: 4c2e…
```
```json
{ "processingType": "ADVANCE", "processedUntil": "2026-10-13", "departmentId": null, "employeeIds": null }
```
→ `202 { "data": { "jobId": "…", "processingRunId": "…" } }`. In Phase 1 it runs inline and returns `200` with the finished run (same shape as `GET /processing-runs/:id`).

- `processingType` defaults to `FULL`. `RECONCILIATION` can't be requested here; it is started by import commit or by `/reconcile` (§5.12).
- `processedUntil` is **required** for `ADVANCE` and **not allowed** for `FULL` (`PROCESSED_UNTIL_REQUIRED`). It must satisfy `period.startDate ≤ processedUntil < period.endDate` (`ADVANCE_DATE_OUT_OF_PERIOD`). The period must be `OPEN` (`PERIOD_NOT_OPEN`).
- Dates up to `processedUntil` are processed from punches as usual. Each later date with scheduled minutes gets an advance credit (`ADVANCED`, event `CREATED`) and a processed day with `attendanceBasis = ADVANCE`, `status = ADVANCE_CREDIT`. The rules are in [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] §12.
- Running ADVANCE again with a later `processedUntil` (e.g. Oct 13, then Oct 14) **doesn't duplicate credits**. Dates that are now inside the actual range are processed from punches, and their open credits are closed by that run (whether as `RECONCILED`/`ADJUSTED`/`REVERSED` or as `CANCELLED` is decided in BUSINESS-RULES §12; the summary reports both counts). The one-open-credit-per-date rule is owned by [[CVSU-DTR/v3/DATABASE-MAPPING|DATABASE-MAPPING]] §8. ⚠ Assumption: a later FULL run on a period that still has `ADVANCED` credits leaves them alone; only reconciliation changes them.
- Two runs on the same period at once → `409 PROCESSING_IN_PROGRESS` (advisory lock, DESIGN-PATTERNS §7).
- Employees without an approved schedule get no credit and stay `NO_SCHEDULE` (blocking).

Run result (`GET /processing-runs/:id`):
```json
{
  "data": {
    "id": "uuid", "dtrPeriodId": "uuid",
    "processingType": "ADVANCE", "processedUntil": "2026-10-13",
    "status": "SUCCEEDED", "requestedBy": { "id": "uuid", "name": "HR Admin" },
    "queuedAt": "…", "startedAt": "…", "finishedAt": "…",
    "importBatchId": null,
    "scope": { "departmentId": null, "employeeIds": null },
    "summary": {
      "employeesProcessed": 1000, "daysProcessed": 15000,
      "advanceDates": ["2026-10-14", "2026-10-15"],
      "creditsCreated": 1980, "creditsClosed": 0, "creditsCancelled": 0, "creditedMinutesTotal": 1069200,
      "employeesWithoutSchedule": 12, "blockingDays": 37
    },
    "error": null
  }
}
```
For a `RECONCILIATION` run, `summary` has the same fields as the commit's `reconciliation` object (§5.6), and `importBatchId` is set when an import started it. An import whose dates span two periods creates one run per period.

`GET /attendance/:id` (§6) returns `attendanceBasis` (`ACTUAL | SCHEDULE_DERIVED | ADVANCE | MIXED`) and, for advance days, `advanceCreditId`. `slotSources` values gain `SCHEDULE` and `ADVANCE`.

### 5.8 Exceptions
```
GET    /attendance-exceptions               ?status&employeeId&type&from&to
POST   /attendance-exceptions               HR creates (status PENDING)
GET    /attendance-exceptions/:id
POST   /attendance-exceptions/:id/approve   HR_ADMIN, must differ from requester
POST   /attendance-exceptions/:id/reject    { reason }
POST   /attendance-exceptions/:id/cancel    requester, while PENDING
POST   /attendance-exceptions/:id/revoke    HR_ADMIN, { reason }; blocked if the covering DTR is FINALIZED+
POST   /attendance-exceptions/:id/endorse   v3 [P1B] DEPARTMENT_HEAD (scope, ≠ requester): PENDING → ENDORSED  { remarks? }
```

**v3 changes** (ADR-27, ADR-28, ADR-31). The effects of each type and the limits are owned by [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] §8. This section only covers the API.

| Type | Filed by | Flow | Phase | Extra request rules |
|---|---|---|---|---|
| `ASYNCHRONOUS` | HR_STAFF (scope), HR_ADMIN | Created as `APPROVED`, `autoApproved = true` (audited). No endorse/approve. | [P1] | `scope` must be `WHOLE_DAY` (`EXCEPTION_SCOPE_NOT_ALLOWED`). Attachment optional. |
| `OFFSET` | Employee (`/me`), or HR on behalf | `PENDING → ENDORSED → APPROVED` | [P1B] | Balance checked at endorse **and** approve (`OFFSET_BALANCE_INSUFFICIENT`); submit only returns a warning. Scope `WHOLE_DAY`, `AM`, `PM` or `SCHEDULE_BLOCK` (`scheduleBlockId`). |
| `WELLNESS` | Employee (`/me`), or HR on behalf | `PENDING → ENDORSED → APPROVED` | [P1B] | `scope = WHOLE_DAY` only (`WELLNESS_WHOLE_DAY_ONLY`, at submit). Limit checked at endorse and approve (`WELLNESS_LIMIT_REACHED`); submit only returns a warning. |
| `MAKE_UP_CLASS` | Employee (`/me`), or HR on behalf | `PENDING → APPROVED` by the **Head** (one level) | [P1B] | `attachmentFileId` (the letter) **required** (`MAKEUP_LETTER_REQUIRED`). `makeup` object required (§6). `scope = SCHEDULE_BLOCK`. |

- `approve` on an `OFFSET` or `WELLNESS` request that is still `PENDING` → `422 ENDORSEMENT_REQUIRED`.
- `approve` on `MAKE_UP_CLASS` by anyone other than a `DEPARTMENT_HEAD` in scope → `403`.
- `endorse` on a type that has no level 1 → `422 EXCEPTION_INVALID_TRANSITION`.
- `reject` works from `PENDING` (level 1, Head) and from `ENDORSED` (level 2, HR). The response includes `rejectedLevel`. A reason is required.
- `cancel` (requester) works from `PENDING` **and** `ENDORSED`. ⚠ Assumption: cancelling after endorsement is allowed.
- Approving (or revoking) an exception for a date that is already reconciled re-reconciles that date (`trigger = EXCEPTION_APPROVED`). If the date's DTR is already finalized, the change lands in the next open DTR as a carry-forward row (ADR-25, D-HR-09, D-HR-22). The source is `ADVANCE_CREDIT` for a credited date, and `LATE_EXCEPTION` for a date with no credit (e.g. a make-up letter approved after finalization, test M06). The approve response then includes `carryForward: { id, appliedInDtrPeriodId, minutes }`.
- `GET /attendance-exceptions` filters gain `?status=ENDORSED`, `?type=…` (new values) and `?awaitingLevel=DEPARTMENT|HR` (the two approval queues). Responses add `endorsedBy`, `endorsedAt`, `endorseRemarks`, `rejectedLevel`, `autoApproved`, `scheduleBlockId`, and for `MAKE_UP_CLASS` the `makeup` object with `outcome` (`PENDING | ATTENDED | PARTIAL | NOT_ATTENDED`, set by reconciliation).
- **Phase 1 stop-gap:** HR records already-approved paper requests (offset, wellness, make-up) as day remarks ([[CVSU-DTR/v3/PHASE1-MVP-1-MONTH|PHASE1-MVP]] §5). ASYNCHRONOUS can also be entered from the day-remark shortcut.

### 5.9 DTR
```
POST   /dtr-periods/:id/generate-dtrs       { employeeIds?, departmentId? } → 202 { jobId }
GET    /dtrs                                ?dtrPeriodId&departmentId&status&employeeId&q
GET    /dtrs/:id                            items, totals, flags, history, documents
POST   /dtrs/:id/regenerate                 DRAFT/RETURNED
POST   /dtrs/:id/submit-for-review          HR on behalf (bulk variant below)
POST   /dtrs/:id/validate                   FOR_REVIEW → VALIDATED  { overrideRemarks?: {date: text} }
POST   /dtrs/:id/return                     { reason }
POST   /dtrs/:id/finalize                   VALIDATED → FINALIZED (PDF rendered async; 202)
POST   /dtrs/:id/receive                    FINALIZED/SUBMITTED → RECEIVED
POST   /dtrs/:id/reject-submission          SUBMITTED → FINALIZED  { reason }
POST   /dtrs/:id/reopen                     { reason } → DRAFT, version + 1
GET    /dtrs/:id/pdf                        current document (or ?version=n)
POST   /dtrs/bulk/:action                   { dtrIds[] } for submit-for-review | validate | finalize | receive
                                            → 200 { succeeded[], failed[{id, code}] }
GET    /dtrs/verify/:code                   HR only: checks a printed hash code against dtr_documents
GET    /dtrs/:id/adjustments                v3 [P1+] prior-period adjustment lines applied in this DTR
```

**v3: DTR read and print** (ADR-21, ADR-22, ADR-25, ADR-26):
- A DTR covers **one semi-monthly period** [P1]. Items exist only for that period's days. The printed form leaves the other days of the month blank (analysis §8.7 O-6, to confirm against HR's template).
- **Advance days [P1]:** the item has `dayStatus = ADVANCE_CREDIT` and `attendanceBasis = ADVANCE`. The slots hold the **schedule times** (`slotSources = ADVANCE`), and `remarks` is `null`. The PDF prints them like a normal day, with no remark (ADR-22, O-4). HR screens show an "Advance" badge from `attendanceBasis`.
- **New totals:** `advanceCreditMinutes` [P1] (sum of credited minutes in this DTR) and `priorPeriodAdjustmentMinutes` [P1+] (signed sum of carried-forward lines; negative = deduction, positive = restoration).
- **Prior-period adjustment lines [P1+]:** `GET /dtrs/:id` includes `adjustments[]` (same as `GET /dtrs/:id/adjustments`). These are the `carry_forward_adjustments` rows applied to this period (ADR-25), from any source: `ADVANCE_CREDIT`, `MAKEUP_CLASS`, `LATE_EXCEPTION` or `MANUAL`. `priorPeriodAdjustmentMinutes` = the sum of their `minutes`. They are **not** day items, because a signed DTR is never changed (ADR-25). The PDF prints them as a "Prior-period adjustment" block under the day grid. The exact wording and position are owned by [[CVSU-DTR/v3/UI_DESIGN|UI_DESIGN]] and follow HR's template.
- Generating or regenerating a DTR picks up every adjustment whose `appliedInDtrPeriodId` is this period. Once the DTR is finalized, the lines it printed are frozen with it (storage: [[CVSU-DTR/v3/DATABASE-MAPPING|DATABASE-MAPPING]] §9). Adjustments that arrive later go to the **next** open period.
- `GET /me/dtrs/:id` returns the same fields, so employees see why a deduction appears.

### 5.10 Reports (read-only; `format=json|xlsx|pdf`, where non-json returns a 202 job)
```
GET /reports/attendance-summary      ?dtrPeriodId&departmentId
GET /reports/tardiness               ?dtrPeriodId|semesterId&departmentId
GET /reports/habitual-tardiness      ?semesterId           (Phase 2)
GET /reports/dtr-submissions         ?dtrPeriodId&departmentId
GET /reports/imports                 ?from&to
GET /reports/employees-without-schedule ?dtrPeriodId
```

### 5.11 Rule sets, audit, files, health
```
GET/POST /rule-sets        GET/PATCH /rule-sets/:id (DRAFT only)   POST /rule-sets/:id/publish
POST     /rule-sets/:id/simulate   { employeeId, date } → calculation trace (for HR testing)
GET      /audit-logs       ?entityType&entityId&actorId&action&from&to
GET      /files/:id        authorized stream; never a public storage URL
GET      /health           liveness (no details)     GET /health/ready (internal: db, storage, jobs)
```

### 5.12 Advance credits and reconciliation (v3)
Roles: HR_STAFF (scope) and HR_ADMIN read; only HR_ADMIN re-runs. Rules: [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] §12. Tables: [[CVSU-DTR/v3/DATABASE-MAPPING|DATABASE-MAPPING]] §8.
```
GET    /advance-credits                     [P1]  ?dtrPeriodId&employeeId&departmentId&status&creditDateFrom&creditDateTo
                                                  &appliedInDtrPeriodId&processingRunId   (sort: creditDate, employee)
GET    /employees/:id/advance-credits       [P1]  ?dtrPeriodId&status   (shortcut for one employee)
GET    /advance-credits/:id                 [P1]  credit + events[] (full history, oldest first)
GET    /dtr-periods/:id/advance-credits/summary  [P1]  counts per status and per date; totals in minutes
POST   /dtr-periods/:id/reconcile           [P1+] HR_ADMIN  { creditDateFrom?, creditDateTo?, employeeIds?,
                                                  includeClosed?: false, reason } → 202 { jobId, processingRunId }
```
- There is **no** create, update or delete endpoint. Credits are created only by an ADVANCE run, and they change only through reconciliation (import commit, exception approval, or the manual re-run). Events are append-only.
- `POST /dtr-periods/:id/reconcile` starts a `RECONCILIATION` run with `trigger = MANUAL` for the credits whose `dtrPeriodId` is this period. It is a **fallback**: the normal recovery from a missing export is simply to import it, and that commit re-evaluates the credits automatically (ADR-24). Use the manual run after a failed automatic run, or after a biometric-ID mapping fix.
  - `includeClosed: false` only re-checks `ADVANCED` credits.
  - `includeClosed: true` also re-checks `REVERSED`/`ADJUSTED` credits, which can produce `RESTORED`/`ADJUSTED` events and carry-forward rows (same re-evaluation as a later import).
  - `reason` is required (audited). `Idempotency-Key` is required.
- A credit list item and the credit detail:
```json
{
  "data": {
    "id": "uuid",
    "employee": { "id": "uuid", "employeeNumber": "EMP-001", "name": "Juan Dela Cruz" },
    "dtrPeriodId": "uuid", "processingRunId": "uuid",
    "creditDate": "2026-10-15", "creditedMinutes": 600,
    "status": "REVERSED", "actualDayStatus": "ABSENT", "adjustmentMinutes": -600,
    "appliedInDtrPeriodId": "uuid", "reconciliationTrigger": "IMPORT",
    "reconciledBy": null, "reconciledAt": "2026-10-19T02:10:00.000Z", "remarks": null,
    "events": [
      { "event": "CREATED",  "fromStatus": null,       "toStatus": "ADVANCED", "adjustmentMinutes": 0,
        "trigger": "ADVANCE_RUN", "processingRunId": "uuid", "actor": { "id": "uuid", "name": "HR Admin" },
        "createdAt": "2026-10-13T08:00:00.000Z" },
      { "event": "REVERSED", "fromStatus": "ADVANCED", "toStatus": "REVERSED", "adjustmentMinutes": -600,
        "trigger": "IMPORT", "importBatchId": "uuid", "processingRunId": "uuid",
        "appliedInDtrPeriodId": "uuid", "actor": null,
        "createdAt": "2026-10-19T02:10:00.000Z" }
    ]
  }
}
```
`events` appears only on `GET /advance-credits/:id`. `actor: null` means the system acted automatically.

**Carry-forward adjustments [P1+]** (ADR-25). There is one append-only ledger, `carry_forward_adjustments`, for every source (`ADVANCE_CREDIT`, `MAKEUP_CLASS`, `LATE_EXCEPTION`, `MANUAL`). Minutes are signed: negative = deduction, positive = restoration. Reads: HR_STAFF (scope), HR_ADMIN. Manual entries: HR_ADMIN only.
```
GET    /carry-forward-adjustments           ?employeeId&departmentId&appliedInDtrPeriodId&originalDtrPeriodId
                                            &sourceType&workDateFrom&workDateTo&unapplied=true
GET    /employees/:id/carry-forward-adjustments   ?appliedInDtrPeriodId   (one employee)
GET    /carry-forward-adjustments/:id       + link to its source (credit + event, make-up, exception)
POST   /carry-forward-adjustments           HR_ADMIN, MANUAL only: { employeeId, workDate, minutes, reason,
                                            appliedInDtrPeriodId? }  → 201   (Idempotency-Key required)
```
- **No update or delete.** To correct an entry, HR_ADMIN posts an opposite `MANUAL` row that names the original in `reason`. ⚠ Assumption: a `reversesAdjustmentId` field may be added if DATABASE-MAPPING models it.
- Rows from the other sources are created **only by the system** (reconciliation, make-up outcome, late approval). `POST` with any other `sourceType` → `422 CARRY_FORWARD_SOURCE_NOT_ALLOWED`.
- `appliedInDtrPeriodId`:
  - If it is left empty, the system picks the next open period (BUSINESS-RULES §12.6).
  - If HR sets it, that period must be OPEN and the employee's DTR there must not be finalized (`CARRY_FORWARD_TARGET_LOCKED`).
- `unapplied=true` lists rows with no target yet, e.g. a separated employee with no later active period (BUSINESS-RULES §12.9). HR settles them outside the system.
- Row shape (also used for `GET /dtrs/:id` → `adjustments[]`):
```json
{ "id": "uuid", "employeeId": "uuid", "sourceType": "ADVANCE_CREDIT",
  "sourceId": "uuid", "sourceEventId": "uuid",
  "workDate": "2026-10-15", "originalDtrPeriodId": "uuid", "appliedInDtrPeriodId": "uuid",
  "minutes": -600, "label": "Prior-period adjustment: Oct 15, absent",
  "reason": null, "createdBy": null, "createdAt": "2026-10-19T02:10:00.000Z" }
```
Column names are owned by [[CVSU-DTR/v3/DATABASE-MAPPING|DATABASE-MAPPING]]. The JSON follows them in camelCase.

### 5.13 Offset and wellness (v3) [P1B]
Rules: [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] §8 (ADR-29, ADR-30).
```
GET    /offset-earning-requests             ?status&employeeId&departmentId&semesterId   (Head's queue: ?status=PENDING)
POST   /offset-earning-requests             HR on behalf (employees use /me/offset-earning-requests)
GET    /offset-earning-requests/:id
POST   /offset-earning-requests/:id/approve DEPARTMENT_HEAD (scope, ≠ requester): PENDING → APPROVED
                                            → writes an EARNED entry in the offset ledger
POST   /offset-earning-requests/:id/reject  DEPARTMENT_HEAD { reason }
POST   /offset-earning-requests/:id/cancel  requester, while PENDING
GET    /employees/:id/offset-balance        ?semesterId (default: current semester)
GET    /employees/:id/offset-ledger         ?semesterId   (entries, newest first)
GET    /employees/:id/wellness-balance      ?academicYearId (default: current)   (served by the exceptions area, MODULES §4)
```
- **Punches for earned offset:** the approval screen also calls `GET /employees/:id/raw-punches?from=<workDate>&to=<workDate>`. In v3 this endpoint is open to `DEPARTMENT_HEAD` (in scope) for that purpose, and the read is audit-logged. A mismatch between the claim and the punches is shown as a warning in the UI and doesn't block approval (analysis §8.7 O-5).
- **Expiry** is done by a scheduled job at semester end (§7). There is no endpoint for it. The job writes `EXPIRED` entries, which show in the ledger.

```json
// GET /employees/:id/offset-balance
{ "data": { "employeeId": "uuid", "semesterId": "uuid", "expiresOn": "2026-12-19",
            "earnedMinutes": 480, "usedMinutes": 240, "expiredMinutes": 0, "reversedMinutes": 0,
            "balanceMinutes": 240, "pendingUseMinutes": 120, "availableMinutes": 120 } }
// GET /employees/:id/wellness-balance
{ "data": { "employeeId": "uuid", "academicYearId": "uuid", "limitDays": 4,
            "approvedDays": 2, "pendingDays": 1, "remainingDays": 1 } }
```
`availableMinutes = balanceMinutes − pendingUseMinutes` (OFFSET requests still `PENDING`/`ENDORSED`). `remainingDays = limitDays − approvedDays − pendingDays`. Both are read models. The limit and counting rules are in BUSINESS-RULES §8.

---

## 6. Key payloads

### Schedule (create/update)
```json
{
  "semesterId": "uuid",
  "effectiveFrom": "2026-08-18",
  "effectiveTo": "2026-12-19",
  "templateId": null,
  "blocks": [
    { "dayOfWeek": 1, "startTime": "08:00", "endTime": "12:00" },
    { "dayOfWeek": 1, "startTime": "13:00", "endTime": "17:00" }
  ]
}
```

### Processed day (`GET /attendance/:id`)
```json
{
  "data": {
    "id": "uuid",
    "employee": { "id": "uuid", "employeeNumber": "EMP-001", "name": "Juan Dela Cruz" },
    "workDate": "2026-10-05",
    "schedule": { "am": ["08:00","12:00"], "pm": ["13:00","17:00"] },
    "slots": { "amIn": "08:15", "amOut": "12:00", "pmIn": "13:00", "pmOut": "17:00" },
    "slotSources": { "amIn": "PUNCH" },
    "attendanceBasis": "ACTUAL",
    "advanceCreditId": null,
    "tardyMinutes": 15, "earlyOutMinutes": 0, "undertimeMinutes": 15, "workedMinutes": 465,
    "status": "LATE", "flags": [], "isBlocking": false,
    "ruleSet": { "code": "NON_TEACHING_STD", "version": 1 },
    "punches": [ { "id": "uuid", "punchedAt": "2026-10-05T00:15:00Z", "used": true } ],
    "exceptions": []
  }
}
```

### Exception (create)
```json
{
  "employeeId": "uuid",
  "type": "TIME_CORRECTION",
  "dateFrom": "2026-10-05", "dateTo": "2026-10-05",
  "scope": "SLOT", "slot": "AM_IN", "timeValue": "08:00",
  "reason": "Biometric device offline 07:50–08:20 (ICT incident #45)",
  "attachmentFileId": null
}
```
v3: `attendanceBasis` (ADR-26) and `advanceCreditId` are added to the processed day. `slotSources` values are `PUNCH | CORRECTION | CERTIFICATION | SCHEDULE | ADVANCE`.

### v3: exception payloads (create)
```json
// ASYNCHRONOUS [P1] — HR only; response status APPROVED, autoApproved true
{ "employeeId": "uuid", "type": "ASYNCHRONOUS", "dateFrom": "2026-10-05", "dateTo": "2026-10-05",
  "scope": "WHOLE_DAY", "reason": "Asynchronous classes (Dean's memo 2026-114)", "attachmentFileId": null }

// WELLNESS [P1B] — whole day only
{ "type": "WELLNESS", "dateFrom": "2026-10-09", "dateTo": "2026-10-09", "scope": "WHOLE_DAY",
  "reason": "Wellness day" }

// OFFSET [P1B] — uses earned offset balance; minutes are derived from the covered schedule blocks
{ "type": "OFFSET", "dateFrom": "2026-10-12", "dateTo": "2026-10-12", "scope": "AM",
  "reason": "Offset for Oct 3 (Saturday enrollment duty)" }

// MAKE_UP_CLASS [P1B] — letter required; one original block → one make-up session
{ "type": "MAKE_UP_CLASS", "scope": "SCHEDULE_BLOCK",
  "dateFrom": "2026-09-05", "dateTo": "2026-09-05",
  "reason": "Class missed: attended regional seminar",
  "attachmentFileId": "uuid",
  "makeup": {
    "originalDate": "2026-09-05", "originalScheduleBlockId": "uuid",
    "makeupDate": "2026-09-12", "makeupStartTime": "08:00", "makeupEndTime": "10:00",
    "makeupRoom": "CAS 204"
  } }
```
- `employeeId` is taken from the token on `/me/attendance-exceptions` and is required on the HR endpoint.
- `MAKE_UP_CLASS`:
  - `dateFrom = dateTo = makeup.originalDate`, and `scheduleBlockId` is set from `makeup.originalScheduleBlockId`.
  - Validation errors: `makeupStartTime < makeupEndTime`; `makeupDate ≠ originalDate` (`MAKEUP_INVALID_DATES`); the original block must be in the employee's approved schedule on `originalDate` (`MAKEUP_BLOCK_NOT_IN_SCHEDULE`).
  - The make-up date may fall in a later period (ADR-31).
- The create response for `OFFSET` and `WELLNESS` includes `requestedMinutes` or `requestedDays`, the current balance (§5.13), and `warnings[]` (e.g. `OFFSET_BALANCE_LOW`, `WELLNESS_LIMIT_NEAR`). Warnings don't block submission.

### v3: earned offset request (create) [P1B]
```json
{ "workDate": "2026-10-03", "timeFrom": "08:00", "timeTo": "12:00",
  "reason": "Saturday enrollment duty", "attachmentFileId": null }
```
`semesterId` is the semester that contains `workDate`; `minutes` is derived from the times. HR on-behalf requests add `employeeId`.

### v3: DTR period and government announcement
```json
// POST /dtr-periods [P1]
{ "semesterId": "uuid", "year": 2026, "month": 10, "periodHalf": 1, "plannedAdvanceDate": "2026-10-13" }
// → { "data": { "id": "uuid", "name": "Oct 2026 (1–15)", "startDate": "2026-10-01", "endDate": "2026-10-15",
//               "periodHalf": 1, "plannedAdvanceDate": "2026-10-13", "status": "DRAFT" } }

// POST /calendar-events [P1]
{ "type": "GOVERNMENT_ANNOUNCEMENT", "eventDate": "2026-10-20", "scope": "ALL",
  "startTime": "15:00", "endTime": null,
  "name": "Work suspension from 3:00 PM", "reference": "MC No. 45, s. 2026" }
```

### v3: DTR detail (excerpt of `GET /dtrs/:id`)
```json
{
  "data": {
    "id": "uuid", "dtrPeriod": { "id": "uuid", "name": "Oct 2026 (16–31)", "periodHalf": 2 },
    "status": "DRAFT",
    "totals": { "daysPresent": 10, "tardyMinutes": 35, "undertimeMinutes": 35,
                "advanceCreditMinutes": 1200, "priorPeriodAdjustmentMinutes": -630 },
    "items": [
      { "workDate": "2026-10-30", "amIn": "07:00", "amOut": "12:00", "pmIn": "14:00", "pmOut": "19:00",
        "dayStatus": "ADVANCE_CREDIT", "attendanceBasis": "ADVANCE", "remarks": null }
    ],
    "adjustments": [
      { "id": "uuid", "sourceType": "ADVANCE_CREDIT", "sourceId": "uuid",
        "workDate": "2026-10-15", "originalDtrPeriodId": "uuid",
        "minutes": -600, "label": "Prior-period adjustment: Oct 15, absent" },
      { "id": "uuid", "sourceType": "ADVANCE_CREDIT", "sourceId": "uuid",
        "workDate": "2026-10-14", "originalDtrPeriodId": "uuid",
        "minutes": -30, "label": "Prior-period adjustment: Oct 14, late 30 min" }
    ]
  }
}
```
`adjustments[]` are the `carry_forward_adjustments` rows applied to this period (§5.12, full row shape there). `sourceType` is one of:
- `ADVANCE_CREDIT`: reconciliation of an advance credit (ADR-24)
- `MAKEUP_CLASS`: a missed make-up (ADR-31)
- `LATE_EXCEPTION`: an exception or letter approved after the DTR was finalized (D-HR-09, D-HR-22)
- `MANUAL`: entered by HR_ADMIN

`totals.priorPeriodAdjustmentMinutes` = Σ `adjustments[].minutes`.

### DTR transition
```http
POST /api/v1/dtrs/7c1…/finalize
If-Match: 3
Idempotency-Key: 0b8f…
```
```json
{ "data": { "id": "7c1…", "status": "FINALIZED", "version": 1, "document": { "status": "RENDERING", "jobId": "…" } } }
```

---

## 7. Async jobs
- Job types: `IMPORT_VALIDATE`, `PROCESS_ATTENDANCE`, `GENERATE_DTRS`, `RENDER_DTR_PDF`, `EMPLOYEE_IMPORT`, `REPORT_EXPORT`.
- v3 job types:
  - `PROCESS_ATTENDANCE` also covers ADVANCE runs (`processingType` is in the payload).
  - `RECONCILE_ADVANCE_CREDITS` [P1+]: started by import commit, a late exception approval, or `/reconcile`.
  - `OFFSET_EXPIRY` [P1B]: a **scheduled** pg-boss job (cron, daily). It expires the balances of semesters whose `end_date` has passed. It has no endpoint and is idempotent: one `EXPIRED` entry per employee and semester.
  - In Phase 1, jobs run inline (`InlineJobQueue`). The expiry job needs pg-boss, which arrives in Phase 1B together with offset itself. No Redis.
- A job's domain record (`processing_jobs`) is read with `GET /processing-runs/:id`. `GET /jobs/:id` only reports queue progress.
- `GET /jobs/:id` is only visible to the requester and HR_ADMIN.
- Retrying the same `Idempotency-Key` within 24 h returns the original job rather than starting a new one.

## 8. Files
- **Upload:** `multipart/form-data`, max 20 MB (Nginx 25 MB). Check the extension against the whitelist and check magic bytes (ZIP signature for xlsx). Reject macros (`.xlsm`). Enforce row and sheet limits, and a zip-bomb guard (uncompressed size limit).
- **Download:** always through an authorized endpoint with `Content-Disposition: attachment` and `Cache-Control: no-store`.
- **Exports:** escape cells starting with `= + - @ \t \r` (CSV/formula injection).

---

## 9. Errors

```json
{
  "error": {
    "code": "DTR_INVALID_TRANSITION",
    "message": "DTR cannot be finalized from status FOR_REVIEW.",
    "details": { "from": "FOR_REVIEW", "action": "finalize" },
    "requestId": "req_01J…",
    "timestamp": "2026-10-06T03:20:00.000Z"
  }
}
```

| HTTP | When |
|---|---|
| 400 | Malformed request / DTO validation (`VALIDATION_ERROR`, `details: [{field, message}]`) |
| 401 | Missing or expired token (`AUTH_TOKEN_EXPIRED`, `AUTH_INVALID_CREDENTIALS`) |
| 403 | Authenticated, but the role lacks the capability |
| 404 | Not found **or out of scope** |
| 409 | Uniqueness / concurrency / duplicate (`CONCURRENT_MODIFICATION`, `EMPLOYEE_NUMBER_EXISTS`) |
| 413 | File too large |
| 422 | Business rule violation (`DTR_INVALID_TRANSITION`, `DTR_HAS_BLOCKING_FLAGS`, `MAKER_CHECKER_VIOLATION`; v3: `WELLNESS_LIMIT_REACHED`, `OFFSET_BALANCE_INSUFFICIENT`, `MAKEUP_LETTER_REQUIRED`, `ENDORSEMENT_REQUIRED`, …) |
| 429 | Rate limited |
| 500 | Unexpected (generic message; details only in logs) |

**Error codes** (stable; the UI switches on `code`):
```
AUTH_INVALID_CREDENTIALS  AUTH_TOKEN_EXPIRED  AUTH_ACCOUNT_LOCKED  AUTH_REFRESH_REUSED
VALIDATION_ERROR  CONCURRENT_MODIFICATION  IDEMPOTENCY_KEY_REQUIRED
EMPLOYEE_NOT_FOUND  EMPLOYEE_NUMBER_EXISTS  EMPLOYEE_INACTIVE  BIOMETRIC_MAPPING_OVERLAP
PERIOD_NOT_OPEN  PERIOD_OVERLAP  PERIOD_HAS_UNFINALIZED_DTRS
SCHEDULE_OVERLAP  SCHEDULE_INVALID_BLOCK  SCHEDULE_LOCKED  SCHEDULE_INVALID_TRANSITION
IMPORT_INVALID_FORMAT  IMPORT_TOO_LARGE  IMPORT_MISSING_COLUMNS  IMPORT_INVALID_TRANSITION  IMPORT_DUPLICATE_FILE_WARNING
EXCEPTION_INVALID_TRANSITION  MAKER_CHECKER_VIOLATION  EXCEPTION_PERIOD_LOCKED
RULESET_NOT_FOUND  RULESET_PUBLISHED_IMMUTABLE
DTR_NOT_FOUND  DTR_INVALID_TRANSITION  DTR_HAS_BLOCKING_FLAGS  DTR_NO_SCHEDULE  DTR_DOCUMENT_NOT_READY
JOB_NOT_FOUND
```

**v3 error codes:**

| Code | HTTP | When | Phase |
|---|---|---|---|
| `PERIOD_INVALID_HALF` | 400 | `startDate`/`endDate` don't match `periodHalf` (1–15 or 16–end) | P1 |
| `ADVANCE_DATE_OUT_OF_PERIOD` | 422 | `processedUntil` or `plannedAdvanceDate` is not in `[startDate, endDate)` | P1 |
| `PROCESSED_UNTIL_REQUIRED` | 400 | ADVANCE run without `processedUntil`, or `processedUntil` sent with FULL | P1 |
| `PROCESSING_IN_PROGRESS` | 409 | Another processing or reconciliation run holds the period lock | P1 |
| `ADVANCE_CREDIT_NOT_FOUND` | 404 | Unknown or out-of-scope credit | P1 |
| `CALENDAR_SCOPE_NOT_ALLOWED` | 400 | `GOVERNMENT_ANNOUNCEMENT` with `scope ≠ ALL` | P1 |
| `EXCEPTION_SCOPE_NOT_ALLOWED` | 400 | `ASYNCHRONOUS` not `WHOLE_DAY`, or `MAKE_UP_CLASS` not `SCHEDULE_BLOCK` | P1 / P1B |
| `RECONCILIATION_FAILED` | — | Not an HTTP error: the value of `reconciliation.status = FAILED` on commit. The punches stay committed. | P1+ |
| `WELLNESS_WHOLE_DAY_ONLY` | 422 | `WELLNESS` with a scope other than `WHOLE_DAY` (at submit) | P1B |
| `WELLNESS_LIMIT_REACHED` | 422 | Approved + pending + requested wellness days > 4 in the academic year (at endorse/approve) | P1B |
| `OFFSET_BALANCE_INSUFFICIENT` | 422 | Available offset minutes < requested minutes (at endorse/approve) | P1B |
| `MAKEUP_LETTER_REQUIRED` | 422 | `MAKE_UP_CLASS` without `attachmentFileId` | P1B |
| `MAKEUP_INVALID_DATES` | 400 | `makeupDate = originalDate`, or `makeupStartTime ≥ makeupEndTime` | P1B |
| `MAKEUP_BLOCK_NOT_IN_SCHEDULE` | 422 | `originalScheduleBlockId` isn't in the approved schedule on `originalDate` | P1B |
| `ENDORSEMENT_REQUIRED` | 422 | HR approves an `OFFSET`/`WELLNESS` request or a schedule that is not yet `ENDORSED` | P1B |
| `MAKER_CHECKER_VIOLATION` | 422 | Existing code. v3 adds `details.level = ENDORSE \| APPROVE`: endorser = requester, approver = requester, or earned-offset reviewer = requester | P1B |
| `OFFSET_EARNING_INVALID_TRANSITION` | 422 | Earned-offset request action not allowed from its status | P1B |
| `CARRY_FORWARD_SOURCE_NOT_ALLOWED` | 422 | `POST /carry-forward-adjustments` with a `sourceType` other than `MANUAL` | P1+ |
| `CARRY_FORWARD_TARGET_LOCKED` | 422 | The chosen `appliedInDtrPeriodId` isn't OPEN, or the employee's DTR there is FINALIZED or later | P1+ |

```
v3: PERIOD_INVALID_HALF  ADVANCE_DATE_OUT_OF_PERIOD  PROCESSED_UNTIL_REQUIRED  PROCESSING_IN_PROGRESS
    ADVANCE_CREDIT_NOT_FOUND  CALENDAR_SCOPE_NOT_ALLOWED  EXCEPTION_SCOPE_NOT_ALLOWED
    WELLNESS_WHOLE_DAY_ONLY  WELLNESS_LIMIT_REACHED  OFFSET_BALANCE_INSUFFICIENT
    MAKEUP_LETTER_REQUIRED  MAKEUP_INVALID_DATES  MAKEUP_BLOCK_NOT_IN_SCHEDULE
    ENDORSEMENT_REQUIRED  OFFSET_EARNING_INVALID_TRANSITION
    CARRY_FORWARD_SOURCE_NOT_ALLOWED  CARRY_FORWARD_TARGET_LOCKED
```
Warnings (non-blocking, returned in `data.warnings[]` as `{ code, message }`): `OFFSET_BALANCE_LOW`, `WELLNESS_LIMIT_NEAR`, `SUSPECTED_DATA_GAP`.

Domain code throws typed errors (`InvalidTransitionError`, `MakerCheckerViolationError`…). A global exception filter maps them to the codes above.

---

## 10. Versioning and documentation
- Additive changes (new optional fields or endpoints) stay in `v1`. Removing or renaming fields, or changing meaning, requires `v2`.
- The docs v3 changes are additive, so the API stays `/api/v1`. The new enum values (`ENDORSED`, `ADVANCE_CREDIT`, `ADVANCE`, …) count as additive, because the web client is generated from OpenAPI in the same release.
- OpenAPI served at `/api/docs` in dev/staging only. The frontend types are generated from it (`openapi-typescript`) in CI, and a drift check fails the build.
