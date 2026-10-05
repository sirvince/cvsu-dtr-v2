---
title: CVSU DTR — Requirements and Scope
version: 3.0
status: draft
updated: 2026-10-05
---

# CVSU DTR — Requirements and Scope

Related: [[CVSU-DTR/v3/README|README]] · [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] · [[CVSU-DTR/v3/UI_DESIGN|UI_DESIGN]] · [[CVSU-DTR/v3/PHASE1-MVP-1-MONTH|PHASE1-MVP-1-MONTH]] · Source of v3 changes: [[CVSU-DTR/HR-Requirements-Analysis|HR-Requirements-Analysis]]

> [!info] What changed in v3
> - **Semi-monthly** DTR periods. Each half-month is printed on its own CSC Form 48 (ADR-21). §1, §2, §4, US-06 and the non-functional requirements are updated.
> - **Advance processing**, **advance credits** and **automatic reconciliation** with **carry-forward** adjustments (ADR-22 to ADR-26). New stories US-15 to US-18. Reconciliation covers only the batch's date range and device, and a later import can restore a credit (ADR-24). All carry-forwards are rows of one `carry_forward_adjustments` ledger, including HR_ADMIN manual adjustments (ADR-25).
> - New attendance reasons (ADR-27): HR-entered `ASYNCHRONOUS`, the `GOVERNMENT_ANNOUNCEMENT` calendar event (US-19), and a Phase 1 stop-gap for paper requests (US-20).
> - **Phase 1B**: `OFFSET`, `WELLNESS` and `MAKE_UP_CLASS` requests, two-level approval, offset balance and wellness limit (ADR-28 to ADR-31). New stories US-21 to US-25. US-03 and US-04 now use the two-level schedule approval.
> - §3: the Department Head also stands for the Dean. §4 now follows the agreed phase split. §5 lists the new blockers (B7 to B11).

---

## 1. Problem statement

HR currently:
1. exports attendance from the biometric device (ZKTeco MB20),
2. splits the spreadsheet by department by hand,
3. works out time-in/out, tardiness and undertime by hand for every employee,
4. types or checks DTRs, and
5. validates the same data again when signed DTRs come back.

**v3:** HR also:

6. closes each **semi-monthly cutoff** (1–15 and 16–end) **2–3 days early**. The remaining days are credited in advance using the schedule, and HR checks them against actual attendance afterwards.
7. handles paper requests (offset, wellness, make-up class) that a Department Head or Dean and then HR must approve.

This process is slow, error-prone and hard to audit. The system automates steps 2–4 and 6, supports steps 5 and 7, and keeps the existing wet-signature DTR.

## 2. Goals and success measures

| Goal | Measure (target) |
|---|---|
| Less HR encoding time | DTR preparation for all employees for **each semi-monthly period** in **< 1 working day** after the last export (v2 said "monthly") |
| On-time cutoff | Advance-processed DTRs for a period are ready on the **planned advance date** (`planned_advance_date`, ADR-22) |
| No manual reconciliation | **100%** of advance credits covered by a committed import are reconciled automatically (ADR-24). HR reconciles **nothing** by hand. |
| Fewer errors | **0** calculation discrepancies against the HR-approved test cases (BUSINESS-RULES §10, including the v3 cases F, A, R and M) |
| Transparency for employees | Employees can see their processed attendance **within 1 day** of each import (Phase 1B) |
| Auditability | Every correction, status change, advance credit and reconciliation shows who, when and why |
| Submission tracking | HR can list who has/hasn't submitted a signed DTR for any period in one screen |

## 3. Users

| Role | Main needs |
|---|---|
| EMPLOYEE (faculty, non-teaching, COS/JO) | See schedule and attendance, request corrections, confirm and download DTR, track submission. **v3 (1B):** file `OFFSET` / `WELLNESS` / `MAKE_UP_CLASS` requests and earned-offset claims, see the offset balance and wellness days left. |
| DEPARTMENT_HEAD | Review department attendance, act as "In-Charge". **v3:** **endorse** (level 1) schedules and `OFFSET` / `WELLNESS` requests, and **approve** `MAKE_UP_CLASS` and earned-offset requests (Head-only level). **A Dean has no separate role.** A Dean acts as `DEPARTMENT_HEAD`, with a scope that covers the college's departments (ADR-28, [[CVSU-DTR/v3/API-DESIGN#3. Scope and ownership\|API-DESIGN §3]]). |
| HR_STAFF | Import files, map unmatched IDs, record exceptions, validate DTRs, receive signed copies. **v3:** run advance processing; review advance credits and reconciliation results; record `ASYNCHRONOUS` days. |
| HR_ADMIN | Everything HR_STAFF does, plus approve exceptions, finalize/reopen DTRs, manage periods, calendar and rule sets. **v3:** **approve** (level 2) endorsed schedules and `OFFSET` / `WELLNESS` requests; record `GOVERNMENT_ANNOUNCEMENT` events; re-run reconciliation by hand. |
| SYSTEM_ADMIN | Users, roles, departments, devices, system settings, audit log. **No** authority over attendance values. |

In Phase 1 only HR accounts exist (role `HR_ADMIN`, see [[CVSU-DTR/v3/PHASE1-MVP-1-MONTH|PHASE1-MVP-1-MONTH]] §1). The capability matrix is owned by [[CVSU-DTR/v3/API-DESIGN#4. Roles and permissions|API-DESIGN §4]].

---

## 4. Scope by phase

> [!note] Naming
> **Phase 1** is the 1-month, HR-only build in [[CVSU-DTR/v3/PHASE1-MVP-1-MONTH|PHASE1-MVP-1-MONTH]] (deadline Oct 30, 2026). The wider "MVP" that v2 listed here as Phase 1 is now **Phase 1B** (see [[CVSU-DTR/v3/DEVELOPMENT-PHASES|DEVELOPMENT-PHASES]]). Dates and order belong to those two documents. This section only says **what** is in each phase.

### Phase 1: HR-only MVP (deadline Oct 30, 2026)
- HR authentication (HR accounts only), users, audit log
- Employees, departments, one biometric device, biometric ID mapping (bulk CSV import of employees)
- Academic years, semesters and **semi-monthly DTR periods** (1–15, 16–end), with an optional `planned_advance_date` (ADR-21, ADR-22)
- Calendar: holidays, work suspensions and **`GOVERNMENT_ANNOUNCEMENT`** (government-wide, can be partial-day; ADR-27)
- Schedules: default template **plus per-employee schedule blocks** entered by HR, so faculty can have several entries per day (ADR-08, ADR-32). HR creates them directly as `APPROVED` (audited).
- Attendance import (XLSX/CSV from MB20): validate → review errors → commit
- Attendance processing per DTR period (synchronous), including **advance processing up to a chosen `processed_until`** (ADR-22). Advance credits are **printed with time in/out from the schedule** (D-HR-05).
- Day remarks entered by HR: leave, official business, **`ASYNCHRONOUS` (whole day)**, and a **stop-gap** that records already-approved **paper** `OFFSET` / `WELLNESS` / `MAKE_UP_CLASS` requests (US-20)
- DTR generation (bulk, per period), preview, a **half-month CSC Form 48 PDF** (D-HR-17)
- DTR lifecycle (Phase 1 subset): `DRAFT ↔ FINALIZED` (finalize / unlock with a reason)
- HR dashboard "Needs Attention" (basic warnings)

### Phase 1, follow-up: reconciliation (must be live before the **second** cutoff after go-live)
The first advance credits are reconciled one cutoff after the first advance run (about 2 weeks). This group ships either at the end of Phase 1 or as the first item of Phase 1B. See [[CVSU-DTR/v3/PHASE1-MVP-1-MONTH|PHASE1-MVP-1-MONTH]] for when.
- **Automatic reconciliation** on import commit, with a summary and a **suspected data-gap** warning (ADR-24, US-17)
- **Advance-credit history** (`advance_credit_events`, append-only; ADR-23, US-16)
- **Carry-forward adjustments** shown on the next DTR (ADR-25, US-18)

### Phase 1B: self-service, approvals and the full DTR cycle
Carried over from the v2 "Phase 1 — MVP" list:
- Employee and Department Head logins, department scoping
- Schedule submission by employees, with **two-level approval** (Department Head/Dean endorses → HR approves; ADR-28, D-HR-21)
- Exceptions with maker-checker
- Full DTR lifecycle: review → validate → finalize → submit → receive / return / reopen
- Basic reports (attendance summary, tardiness, submission status, import log)

New in v3:
- `OFFSET`, `WELLNESS` and `MAKE_UP_CLASS` requests (ADR-27). Two-level approval for `OFFSET` / `WELLNESS`. **Head/Dean-only** approval for `MAKE_UP_CLASS` and earned offset (ADR-28).
- **Offset earning, balance and semester-end expiry** (ADR-29)
- **Wellness limit**: 4 whole days per academic year (ADR-30)
- **Make-up class** rules: required letter, original date absent until the letter is approved, make-up date checked against punches, outcome carried forward (ADR-31)

### Phase 2: self-service and efficiency
- Employee correction requests (with attachment)
- Email notifications (import done, DTR ready, DTR returned; **v3:** request endorsed/approved/rejected, reconciliation deductions)
- Habitual-tardiness report
- Excel/PDF export of reports
- Multiple campuses, per-campus HR scoping

### Phase 3: integration
- Direct device sync (ADMS push / vendor SDK) through `AttendanceSource`
- SSO (e.g., Google Workspace / OIDC) if CvSU uses it
- Integration with HR/payroll or leave systems

### Out of scope (all phases unless re-decided)
- Replacing the wet signature with e-signatures
- Payroll computation and leave-credit deduction. The system *reports* tardiness, undertime and carry-forward adjustments; HR/payroll applies the deductions.
- Changing a finalized/signed DTR because of a later reconciliation. Adjustments always land on a later DTR (ADR-25).
- Mobile native apps (the web app is responsive)

---

## 5. Blockers: obtain before implementation

| # | Item | Needed for | Owner |
|---|---|---|---|
| B1 | 2–3 **real MB20 export files** (different months, including one with errors) | Parser contract, dedup key | HR |
| B2 | The **official DTR template** CvSU uses (scan or file) and a filled sample | PDF generator layout | HR |
| B3 | HR's **written attendance policy**: office hours, grace, flexi-time, faculty rules, COS/JO rules | Rule set v1 | HR |
| B4 | Answers to **Open Questions** in BUSINESS-RULES §11 | Calculators | HR |
| B5 | Employee master list with biometric enrolment numbers | Initial data load | HR |
| B6 | Deployment target (on-prem server or VPS), domain, TLS | Deployment | ICT office |
| B7 | **v3, O-6:** the official **half-month** DTR template, or a printed half-month sample: how days outside the period appear, and where the "prior-period adjustment" line goes (D-HR-17) | Half-month Form 48 layout (Phase 1) | HR |
| B8 | **v3, O-3:** the **effective date** of a mid-semester schedule change. Proposed default: the date in the request, but not earlier than the first non-finalized period. | Schedule versioning (Phase 1B) | HR |
| B9 | **v3, O-4:** **written confirmation** that advance-credit days print **with schedule times and no remark** (D-HR-05). See SECURITY-PRIVACY §5.1. | Form 48 content (Phase 1) | HR (signed) |
| B10 | **v3, O-5:** must earned-offset claims match biometric punches? Proposed default: punches are shown to the approver, and a mismatch is a warning, not a block. | Earned-offset approval (Phase 1B) | HR |
| B11 | **v3, O-7:** a make-up class that is **partly attended**. Proposed default: tardy/undertime counted on the make-up date, and the original date stays excused. Also **O-2**: are make-up classes approved by the Head only? Proposed default: yes. | Make-up processing (Phase 1B) | HR |

Proposed defaults apply until HR answers. They are listed in [[CVSU-DTR/HR-Requirements-Analysis#8.7 Still open after round 2|the analysis §8.7]] and BUSINESS-RULES §11.

---

## 6. User stories and acceptance criteria

Format: **ID — As a … I want … so that …** followed by acceptance criteria (AC). The tag after the title gives the phase: **[P1]** Phase 1, **[P1+]** the Phase 1 reconciliation follow-up, **[P1B]** Phase 1B. The rules behind the ACs are owned by [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]]: §12 for advance processing and reconciliation, §8 for exceptions, §6 for schedules.

### Import
**US-01 — As HR_STAFF I want to upload a biometric export so that punches enter the system.** [P1]
- AC1 Accepts `.xlsx` and `.csv` up to 20 MB; any other file is rejected with `IMPORT_INVALID_FORMAT`.
- AC2 Shows a summary before commit: total rows, valid, invalid, **already-known (duplicate) punches**, unmatched biometric IDs, detected date range.
- AC3 Re-uploading the same or an overlapping file creates **no duplicate punches**.
- AC4 Invalid rows are kept with row number, raw values and error code. Nothing is silently dropped.
- AC5 Commit is all-or-nothing per batch.
- AC6 *(v3)* Committing also starts reconciliation of the advance credits that the batch covers (US-17).

**US-02 — As HR_STAFF I want to map unmatched biometric IDs to employees so that their punches count.** [P1]
- AC1 Lists every unmatched `(device, biometric_identifier)` with punch count and date range.
- AC2 Creating a mapping never modifies raw punches; the next processing run picks it up.

### Schedules
**US-03 — As an EMPLOYEE I want to submit my semester schedule so that my attendance is judged against it.** [P1B; HR entry in P1]
- AC1 Several blocks per day are allowed; blocks may not overlap; start < end.
- AC2 *(v3)* Status goes DRAFT → SUBMITTED → **ENDORSED** (Department Head/Dean) → APPROVED (HR) (ADR-28, D-HR-21). It only affects calculations once APPROVED.
- AC3 A schedule cannot be changed for dates in a period whose DTR is FINALIZED.
- AC4 *(v3)* A mid-semester change is a **new version** with an effective date that also needs both approvals. The old version becomes SUPERSEDED from that date. ⚠ The effective-date rule is open (B8 / O-3).
- AC5 *(v3, Phase 1)* Until employee logins exist, HR enters **per-employee blocks** directly (e.g., Mon 07:00–10:00, 10:00–12:00, 14:00–16:00, 16:00–19:00). These are saved as APPROVED and audit-logged. Test cases F01 and F02 (BUSINESS-RULES §10) pass.

**US-04 — As a DEPARTMENT_HEAD I want to endorse or reject submitted schedules, and as HR I want to approve or reject endorsed schedules.** [P1B]
- AC1 Only schedules of my departments are visible. A Dean sees every department in their scope. Out-of-scope schedules return `404`.
- AC2 Rejection at either level requires a reason, which the employee can see. The rejection records its level (`DEPARTMENT` or `HR`).
- AC3 *(v3)* The endorser can't be the submitter, and the HR approver can be neither the submitter nor the endorser (maker-checker at both levels; SECURITY-PRIVACY §3).
- AC4 *(v3)* HR can approve **only** ENDORSED schedules, except schedules HR creates directly (audited, US-03 AC5).

### Processing and DTR
**US-05 — As HR_STAFF I want to process a DTR period so that every employee's daily attendance is calculated.** [P1]
- AC1 Results match BUSINESS-RULES §10 test cases exactly.
- AC2 Re-running is idempotent: same inputs give the same outputs, and no duplicates.
- AC3 DTRs that are FINALIZED or later are **not** changed by reprocessing.
- AC4 Every day stores the rule-set version used.
- AC5 *(v3)* Every day stores its **attendance basis** (`ACTUAL`, `SCHEDULE_DERIVED`, `ADVANCE`, `MIXED`) and the source of each slot (ADR-26).
- AC6 *(v3)* Reprocessing **never** deletes or recreates advance credits or their history (ADR-23).

**US-06 — As HR_STAFF I want to generate DTRs for a period in bulk.** [P1]
- AC1 One DTR per active employee with an approved schedule **per semi-monthly period** (v2 said per month). Employees without an approved schedule are listed as "blocked".
- AC2 Generated DTRs start in DRAFT.
- AC3 *(v3)* DTR totals include `advance_credit_minutes` and `prior_period_adjustment_minutes` (US-15, US-18).

**US-07 — As an EMPLOYEE I want to review my DTR and confirm it or ask for a correction.** [P1B]
- AC1 I see each day in the four-slot layout, with tardy and undertime totals.
- AC2 "Confirm" moves DRAFT → FOR_REVIEW. "Request correction" creates an exception request (Phase 2) or a note to HR (Phase 1B).
- AC3 *(v3)* Advance days and prior-period adjustments are labelled on screen, even though the printed form shows advance days like normal days (US-14 AC3).

**US-08 — As HR_STAFF / HR_ADMIN I want to validate and finalize DTRs.** [P1B; Phase 1 has finalize/unlock only]
- AC1 Finalize is only allowed from VALIDATED. If the rule is on, the finalizer must differ from the validator.
- AC2 Finalize produces a PDF, stores its SHA-256 and locks the DTR items.
- AC3 Return requires a reason and moves the DTR to RETURNED, which is editable/reprocessable.
- AC4 *(v3)* A DTR with advance days **can be finalized** while its credits are still `ADVANCED`. Finalization never waits for reconciliation (ADR-25).

**US-09 — As an EMPLOYEE I want to download my finalized DTR as a CSC Form 48 PDF.** [P1B; HR download in P1]
- AC1 Download is only available at FINALIZED or later; each download is audit-logged.
- AC2 The printed copy fits one A4/Letter page (two copies side by side if the template requires it).

**US-10 — As HR_STAFF I want to mark a signed DTR as received.** [P1B]
- AC1 Marking RECEIVED records the receiver and time.
- AC2 The submission report shows NOT_SUBMITTED / SUBMITTED / RECEIVED / RETURNED counts per department, **per semi-monthly period** (v3).

**US-13 — As HR_ADMIN I want semi-monthly DTR periods so that each cutoff (1–15, 16–end) has its own DTRs.** [P1]
- AC1 Periods are 1–15 (`period_half = 1`) and 16–last day of the month (`period_half = 2`). A month helper creates both halves. Periods never overlap (ADR-21).
- AC2 HR can set an optional **planned advance date** inside the period (on or after the start, before the end) for each period.
- AC3 All employees (faculty, non-teaching, COS/JO) use the same periods (ADR-32).
- AC4 The global period selector and every list show the period as e.g. "Oct 1–15, 2026".

**US-14 — As HR_STAFF I want to generate and print a half-month CSC Form 48 for each employee.** [P1]
- AC1 The PDF shows only the period's days (1–15 or 16–end). Other days are blank, per the official template (B7 / O-6, ⚠ proposed default).
- AC2 Bulk generation and download (ZIP / merged PDF) work per period and per department, as in Phase 1 v2.
- AC3 Advance-credit days print **time in/out from the schedule** (AM/PM group start and end) with **no remark** (D-HR-05). The system still marks them `ADVANCE_CREDIT` internally and on HR screens (ADR-26).
- AC4 Carried-forward adjustments from earlier periods print as a "prior-period adjustment" line/total in the place B7 defines (US-18).
- AC5 A period's bulk PDF run for 1,000 employees meets the §7 target.

### Advance processing and reconciliation
**US-15 — As HR_STAFF I want to run advance processing up to a date I choose, so that DTRs are ready before the cutoff.** [P1]
- AC1 HR chooses `processed_until` with `period start ≤ processed_until < period end`. The planned advance date is the default but can be changed. Any other date is rejected with a clear error.
- AC2 Before running, a **preview** shows how many employees and days will be credited, and lists employees without an approved schedule (they get no credit and stay `NO_SCHEDULE`, blocking).
- AC3 Days up to `processed_until` are calculated from punches as usual. Each later working day gets **one advance credit** of the **full scheduled minutes** (`ADVANCE_CREDIT`, basis `ADVANCE`). Rest days and holidays get no credit (BUSINESS-RULES §12).
- AC4 Running advance processing again with a later `processed_until` (e.g., Sept 13, then Sept 14) **doesn't duplicate** credits: at most one open credit per employee per date (case A08).
- AC5 The run is stored as a processing job with `processing_type = ADVANCE` and `processed_until`, and audit-logged (`ADVANCE_PROCESSING_RUN`). Each credit logs a `CREATED` event.
- AC6 Test case A01 (BUSINESS-RULES §10) passes.

**US-16 — As HR_STAFF I want to see the advance credits of a period and their full history, so that I can explain every credit and deduction.** [P1 list; P1+ history]
- AC1 Per period, a list of credits with employee, date, credited minutes, status (`ADVANCED`, `RECONCILED`, `ADJUSTED`, `REVERSED`, `CANCELLED`), adjustment minutes and the period where the adjustment was applied. It can be filtered by status, department and date.
- AC2 Each credit opens its **event history** (append-only `advance_credit_events`): the event, from → to status, adjustment, trigger (advance run, import, exception approved, manual), the linked import/request, who did it (or "system") and when.
- AC3 History can't be edited or deleted by anyone, including HR_ADMIN (ADR-23).
- AC4 Opening another employee's credit history is audit-logged as a sensitive read (SECURITY-PRIVACY §5).

**US-17 — As HR_STAFF I want advance credits reconciled automatically when I commit an import, with a summary and a data-gap warning.** [P1+]
- AC1 Committing an import reconciles every `ADVANCED` credit whose date lies **inside the batch's detected date range** (`detected_date_from ≤ credit_date ≤ detected_date_to`), for employees **mapped to the batch's device**. Credits outside that range, or for employees on other devices, stay `ADVANCED` (ADR-24; cases A02–A05).
- AC2 Present → `RECONCILED` (0). Late/undertime → `ADJUSTED` (−minutes). No punches → `REVERSED` (−credited minutes). An approved exception or holiday on that date → `RECONCILED` (BUSINESS-RULES §12).
- AC3 The import result shows a **reconciliation summary** per date: reconciled / adjusted / reversed counts and total minutes, e.g. "142 credits reversed for Sept 15".
- AC4 When more than a set share of the credited employees (default **50%** ⚠, BUSINESS-RULES §12) are reversed for one date, the date is flagged as a **suspected data gap**. The flag shows on the import result and in "Needs Attention" (case A09).
- AC5 Reconciliation runs as a processing job with `processing_type = RECONCILIATION` linked to the batch, and is audit-logged. ⚠ If it fails, the import stays committed, and the failed job shows in "Needs Attention" with a retry (HR_ADMIN can re-run it by hand).
- AC6 The DTR the credit belongs to is **not** changed if it is finalized (ADR-25).
- AC7 A **later import** that brings punches for an already reconciled date **re-evaluates** the credit. For example, the missing export after a suspected data gap: a reversed credit becomes `RECONCILED` or `ADJUSTED`, with a `RESTORED`/`ADJUSTED` event and a positive carry-forward (ADR-24; case A09). The summary shows restored counts.

**US-18 — As HR_STAFF I want reconciliation deductions and restorations to appear on the next DTR, so that a signed DTR is never changed.** [P1+]
- AC1 When the source DTR is **finalized**, each non-zero adjustment is stored as one row of the append-only **`carry_forward_adjustments`** ledger, applied to the employee's **next open DTR period**. The signed DTR is never changed (ADR-25; D-HR-06, D-HR-18). When the source DTR is **not finalized yet**, the day is simply recalculated in its own DTR, and no carry-forward row is created (case A07).
- AC2 The ledger holds every source: `ADVANCE_CREDIT`, `MAKEUP_CLASS`, `LATE_EXCEPTION` (an exception or letter approved after its DTR was finalized) and `MANUAL`. The next DTR shows a **prior-period adjustments** section that lists these rows: original date, source, reason, ± minutes. `prior_period_adjustment_minutes` = the **sum** of the rows applied to that period.
- AC3 A request approved later for a date that was already deducted creates a **positive** (restoring) adjustment in the next open period (case A06; D-HR-09, D-HR-22).
- AC4 If the next period's DTR is already finalized when the adjustment is created, the adjustment moves to the next open period after it. Nothing is lost or applied twice.
- AC5 Regenerating the next DTR keeps its carried-forward adjustments. Ledger rows are never edited or deleted; a mistake is fixed with an opposite row.
- AC6 HR_ADMIN can add a **MANUAL** adjustment (original date, ± minutes, required reason/reference). It is audit-logged, and no other role can add one (SECURITY-PRIVACY §5.3).
- AC7 An adjustment with no later period where the employee is active (e.g., separated) appears on an **unapplied adjustments** list for HR to settle (BUSINESS-RULES §12.9).

### Attendance reasons
**US-19 — As HR I want to record ASYNCHRONOUS days and GOVERNMENT_ANNOUNCEMENT events, so that those days are credited from the schedule.** [P1]
- AC1 `ASYNCHRONOUS` is recorded by HR_STAFF/HR_ADMIN for one employee and a **whole day** only. It is created as APPROVED (`auto_approved`, audited), with no approval step (ADR-27, D-HR-10). A memo or proof attachment is optional.
- AC2 An `ASYNCHRONOUS` day is credited from the schedule: tardy 0, `PRESENT`, basis `SCHEDULE_DERIVED` (case R07). Raw punches stay visible.
- AC3 `GOVERNMENT_ANNOUNCEMENT` is a calendar event recorded by HR_ADMIN. It is government-wide (`scope = ALL`), has an optional memo/reference number, and can be **partial-day** with a start time (case R02, D-HR-11).
- AC4 Adding, changing or removing either one marks the affected days stale. The next processing run recalculates them. If they fall on a credited date, they reconcile the credit (US-17 AC2).

**US-20 — As HR I want to record an already-approved paper OFFSET / WELLNESS / MAKE_UP_CLASS request, so that Phase 1 DTRs are correct before the approval workflow exists.** [P1, stop-gap]
- AC1 HR records the request as a day remark using the **real exception type** (`OFFSET`, `WELLNESS`, `MAKE_UP_CLASS`), created as APPROVED. It records who approved it on paper, the approval date and a reference number. A scan of the signed form can be attached (optional in Phase 1 ⚠).
- AC2 The covered blocks are credited from the schedule, as an approved request would be (D-HR-15; case R01).
- AC3 Phase 1 does **not** check the offset balance or the wellness limit. HR checks them on paper. ⚠ Phase 1 wellness records count toward the 4-day limit once Phase 1B goes live.
- AC4 For `MAKE_UP_CLASS`, HR enters the original and make-up dates and times. In Phase 1 the make-up date is checked by HR, not by the system. ⚠ The automatic outcome (US-25) comes in Phase 1B.
- AC5 The entry is audit-logged with the paper reference (SECURITY-PRIVACY §3).

### Requests and approvals (Phase 1B)
**US-21 — As an EMPLOYEE I want to file an OFFSET, WELLNESS or MAKE_UP_CLASS request.** [P1B]
- AC1 The form changes with the type:
  - `OFFSET`: dates, whole day / AM / PM / schedule block, minutes, reason. The current **offset balance** is shown.
  - `WELLNESS`: whole day(s) only. The **wellness days left** this academic year are shown.
  - `MAKE_UP_CLASS`: original date and block, make-up date, start/end time, room, and the **letter** (required).
- AC2 Validation errors at submission:
  - a half-day wellness request is rejected with `WELLNESS_WHOLE_DAY_ONLY` (R05);
  - a make-up request without a letter is rejected with `MAKEUP_LETTER_REQUIRED` (M07);
  - a wellness request over the limit is rejected with `WELLNESS_LIMIT_REACHED` (US-24);
  - an offset request over the balance is rejected with `OFFSET_BALANCE_INSUFFICIENT` (US-23).
- AC3 New requests are `PENDING`. I can cancel my own request while it is `PENDING` or `ENDORSED`.
- AC4 I can see the status, both reviewers and their remarks. Attachments are visible only to me and the reviewers in scope (SECURITY-PRIVACY §5.2).
- AC5 HR can file on an employee's behalf (S scope). The same approval steps apply, and HR then can't approve that request (maker-checker).

**US-22 — As a DEPARTMENT_HEAD I want to endorse requests, and as HR_ADMIN I want to approve endorsed requests.** [P1B]
- AC1 The Department Head (or Dean) sees an **approvals inbox** of `PENDING` requests for employees in scope only. Others return `404`.
- AC2 `OFFSET` / `WELLNESS`: Head endorses (`PENDING → ENDORSED`) or rejects, then HR approves (`ENDORSED → APPROVED`) or rejects. HR can't approve a request that hasn't been endorsed (ADR-28, D-HR-14).
- AC3 `MAKE_UP_CLASS`: the Head **approves directly** (`PENDING → APPROVED`). There is no HR step (D-HR-20; ⚠ O-2).
- AC4 Rejection at either level needs a reason. The rejection records its level, and the employee sees it.
- AC5 Maker-checker: requester ≠ endorser, and requester ≠ approver. The endorser also can't be the HR approver (`MAKER_CHECKER_VIOLATION`).
- AC6 Only `APPROVED` requests affect processing. Approval marks the covered days stale. If the date's DTR is already finalized, the effect lands in the next open DTR (US-18, D-HR-22). If the date has an advance credit, the credit is re-reconciled (trigger `EXCEPTION_APPROVED`).
- AC7 The wellness limit and the offset balance are checked again at endorsement **and** at approval (US-23, US-24).

**US-23 — As an EMPLOYEE I want to claim earned offset hours, have them approved by my Head/Dean, and see my balance.** [P1B]
- AC1 A claim has the work date, from/to time, minutes, reason and an optional proof attachment. The approval screen shows my raw punches for that date. A mismatch is a **warning**, not a block (⚠ O-5 default).
- AC2 The Head/Dean approves or rejects the claim; it is one level only (ADR-28). Approval writes an `EARNED` entry to the offset ledger for the semester of the work date.
- AC3 The **balance** per semester = earned − used − expired. It is shown on the request form and the employee's page.
- AC4 Approving an `OFFSET` request for more minutes than the balance is rejected with `OFFSET_BALANCE_INSUFFICIENT` (R04). Approval writes a `USED` entry. Revoking or cancelling it writes a `REVERSED` entry.
- AC5 At **semester end**, unused earned minutes expire (an `EXPIRED` entry); the balance in the next semester starts at 0 (R06). The expiry job is audit-logged (`OFFSET_EXPIRED`).

**US-24 — As HR I want the system to enforce the wellness limit, so that nobody gets more than 4 wellness days per academic year.** [P1B]
- AC1 At submission, endorsement and approval, the system counts approved and pending wellness days in the **academic year**, plus the days requested. If the total is over 4, it rejects the request with `WELLNESS_LIMIT_REACHED` (R03; ADR-30).
- AC2 Only whole days count, and only working days (rest days and holidays inside a range are not counted ⚠).
- AC3 Rejected and cancelled requests don't count. The employee and the reviewers see "wellness days left: N".
- AC4 Wellness days recorded through the Phase 1 stop-gap (US-20) are counted.

**US-25 — As HR I want make-up classes evaluated automatically, so that a missed original date is excused only if the make-up happens.** [P1B]
- AC1 Without an approved letter, a missed original block is **ABSENT** (M05). Once the Head approves the letter, the original block is excused (ADR-31, D-HR-25).
- AC2 The make-up time is an extra expected block on the make-up date, even on an unscheduled day. It needs punches, and tardy/undertime are measured against the make-up times (M01, M02; D-HR-23).
- AC3 When an import covering the make-up date is committed, the outcome is set to `ATTENDED`, `PARTIAL` or `NOT_ATTENDED`. `NOT_ATTENDED` reverses the excuse, and the minutes are deducted in the next open DTR (M03; D-HR-24).
- AC4 The make-up date may fall in a later period (M04).
- AC5 A letter approved after the original period was finalized restores the minutes in the next open DTR (M06). Reversals and restorations are `carry_forward_adjustments` rows with source `MAKEUP_CLASS` or `LATE_EXCEPTION` (US-18).

### Exceptions
**US-11 — As HR_STAFF I want to record leave / official business / a time correction for an employee-day.** [P1 as day remarks; P1B with maker-checker]
- AC1 Needs type, date(s), slot(s) or whole day, and a reason; an attachment is optional.
- AC2 Status is PENDING until an HR_ADMIN (not the requester) approves it. *(v3)* `OFFSET`, `WELLNESS` and `MAKE_UP_CLASS` follow US-22 instead. `ASYNCHRONOUS` is auto-approved (US-19). In Phase 1 HR remarks are created APPROVED (US-20).
- AC3 Approved exceptions are applied on the next processing run. The original punches stay visible.
- AC4 *(v3)* An exception approved after its date's DTR was finalized takes effect as a carry-forward adjustment (source `LATE_EXCEPTION`) on the next open DTR (US-18).

### Security
**US-12 — As any user I can only see what my role and scope allow.** [P1, extended in P1B]
- AC1 An employee requesting another employee's DTR by ID gets `404` (no existence leak).
- AC2 Every HR read of an individual DTR or attendance record is audit-logged.
- AC3 *(v3)* Department Heads (and Deans) see requests, attachments and schedules **only** for employees in their department scope (SECURITY-PRIVACY §3).

---

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | Import of 50,000 rows validates in < 60 s; processing a **semi-monthly period** for 1,000 employees in < 5 min (v2: one month); normal pages < 1 s at p95 |
| Volume (v3) | **24 DTR periods a year** instead of 12, so about **2,000 DTRs per month** for 1,000 employees. Bulk PDF generation for one period (1,000 DTRs) completes in < 10 min ⚠ (measure in BE-022 / BE-025). Storage sizing in DATABASE-MAPPING §14 uses twice the v2 DTR count. |
| Advance processing (v3) | An ADVANCE run for 1,000 employees (≤ 3 credited days each) completes within the processing target above. The preview (US-15 AC2) returns in < 5 s. |
| Reconciliation (v3) | Reconciling the credits covered by one import (up to ~3,000 credits) finishes in **< 30 s** after commit ⚠, and the commit response (or its job result) includes the summary. Reconciliation is idempotent: running it twice for the same batch changes nothing the second time. |
| Availability | Business hours; planned maintenance outside office hours; RPO ≤ 24 h, RTO ≤ 4 h |
| Browsers | Current Chrome, Edge, Firefox, Safari; Android Chrome on low-end devices |
| Accessibility | WCAG 2.1 AA principles |
| Privacy | RA 10173 compliance (see SECURITY-PRIVACY), including request attachments (§5.2 there) |
| Auditability | All state changes and corrections audit-logged; audit log append-only. *(v3)* Advance-credit history and the offset ledger are append-only too (ADR-23). |
| Maintainability | Business calculators (day calculator, advance credit, reconciliation, offset balance, wellness count) have ≥ 90% unit-test branch coverage |
| Localization | English UI; dates `MMM D, YYYY`; times `h:mm AM/PM`; timezone Asia/Manila. Periods display as `MMM D–D, YYYY` (e.g., "Oct 16–31, 2026"). |
