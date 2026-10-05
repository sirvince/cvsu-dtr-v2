---
title: CVSU DTR — UI/UX Design
version: 3.0
status: draft
updated: 2026-10-05
---

# CVSU DTR — UI/UX Design

Related: [[CVSU-DTR/v3/REQUIREMENTS|REQUIREMENTS]] · [[CVSU-DTR/v3/API-DESIGN|API-DESIGN]] · [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]]

> **Design goal:** "This system helps me finish my DTR work quickly and correctly." The UI should be minimal, institutional and data-first, with one obvious next action per screen.

> [!info] What changed in v3
> - **Semi-monthly periods** everywhere: the period selector, home and dashboard show e.g. "Oct 1–15, 2026" (ADR-21).
> - New screens for **advance processing and reconciliation** (ADR-22 to ADR-25):
>   - §6.10: the period page with the advance-processing dialog
>   - §6.11: the advance-credits list and history drawer
>   - §6.12: the reconciliation summary on the import result
>   - §6.13: the DTR preview with advance days and prior-period adjustments
> - §6.14: HR day remarks for `ASYNCHRONOUS`, `GOVERNMENT_ANNOUNCEMENT` and the Phase 1 paper-request stop-gap.
> - **Phase 1B** screens: the approvals inbox (§6.15), and My requests with the offset balance, wellness days left and the make-up form with a required letter (§6.16).
> - New status badges (§3), an attendance-basis chip, new "Needs Attention" items (§6.4), and print rules for advance days (§9).
> - The prior-period adjustments section lists the `carry_forward_adjustments` ledger, including HR_ADMIN **manual** adjustments (ADR-25). The reconciliation summary shows the batch's date range and device, plus restorations from later imports (ADR-24).
> - Rules stay in [[CVSU-DTR/v3/BUSINESS-RULES|BUSINESS-RULES]] (§12 advance/reconciliation, §8 exceptions). Endpoints stay in [[CVSU-DTR/v3/API-DESIGN|API-DESIGN]].

---

## 1. Principles (kept from v1, condensed)
1. **Content first.** Show real data (period, status, tardiness), not decorative cards.
2. **One primary action per screen.** Other actions are secondary or go in an overflow menu.
3. **Progressive disclosure.** Table → drawer detail → raw punches / history.
4. **Expected vs actual is always visible.** Never let the scheduled time look like a punch. *(v3)* This applies **on screen**. HR decided that advance days print schedule times like normal days (D-HR-05, see §9), so the screens must keep the distinction.
5. **Explain every number.** Tardy/undertime values have a "Why?" link that shows the calculation trace.
6. **Consistency over novelty.** The same component is used for the same job everywhere.
7. **Calm visuals.** Neutral surfaces, subtle borders, color only for meaning, minimal shadows and motion.

## 2. Visual system

| Token group | Rule |
|---|---|
| Color | Semantic tokens: `primary`, `surface`, `surface-muted`, `border`, `text`, `text-muted`, `success`, `warning`, `danger`, `info`. Primary = official CvSU color (confirm with the university branding office). Must meet WCAG AA contrast. |
| Typography | Inter or the system UI font. Page title 24px, section 18px, body 14–16px, table 14px, meta 12–13px. Tabular numerals for times and minutes. |
| Spacing | 4-px scale; mostly 8 / 12 / 16 / 24 |
| Radius | Inputs/buttons 6px, cards 8px, dialogs 12px; pills only for badges |
| Shadows | Border + one subtle shadow level; drawers/dialogs get one more |
| Motion | ≤ 200 ms fades/slides for drawers and toasts; respect `prefers-reduced-motion` |
| Dark mode | Not in Phase 1 (tokens are ready for it) |

### Time and number formatting
| Value | Display | Example |
|---|---|---|
| Slot / schedule time | 12-hour | `8:05 AM` |
| Minutes | h/m | `1h 35m`, `15 min` |
| Date | `MMM D, YYYY` / `ddd, MMM D` in tables | `Oct 5, 2026` · `Mon, Oct 5` |
| Empty slot | Em dash, with a tooltip explaining why | `—` |
| Corrected slot | Value + small "corrected" marker; raw value in tooltip | `8:00 AM ✎` |
| Schedule-derived slot (v3) | Value in `text-muted` italics + "sched" marker; tooltip names the reason ("From schedule: advance credit", "… Asynchronous", "… Offset") | `7:00 AM ˢ` |
| Period (v3) | `MMM D–D, YYYY` | `Oct 16–31, 2026` |
| Signed minutes (v3) | Sign always shown for adjustments; deductions in `danger`, restorations in `success` | `−30 min`, `+10h 0m` |

## 3. Status badges (v3 statuses)

| Tone | Statuses |
|---|---|
| Neutral | DRAFT, INACTIVE, REST_DAY, DISCARDED, SUPERSEDED, *(v3)* CANCELLED, EXPIRED (offset ledger) |
| Info | FOR_REVIEW, SUBMITTED (DTR), SUBMITTED (schedule), UPLOADED, VALIDATING, QUEUED, RUNNING, HOLIDAY, SUSPENDED, ON_LEAVE, OFFICIAL_BUSINESS, *(v3)* **ADVANCE_CREDIT**, **ENDORSED**, **ADVANCED**, PENDING (make-up outcome, labelled "Awaiting make-up") |
| Success | VALIDATED, FINALIZED, RECEIVED, APPROVED, COMMITTED, SUCCEEDED, PRESENT, *(v3)* **RECONCILED**, **ATTENDED** |
| Warning | LATE, UNDERTIME, LATE_UNDERTIME, HALF_DAY_ABSENT, PENDING, VALIDATED (import with errors), *(v3)* **ADJUSTED**, **PARTIAL**, SUSPECTED DATA GAP |
| Danger | RETURNED, REJECTED, FAILED, ABSENT, INCOMPLETE, NO_SCHEDULE, REVOKED, *(v3)* **REVERSED**, **NOT_ATTENDED** |

Badges always show **text plus color**. Blocking days also get an icon (⚠) and the label "Needs action".

v3 notes:
- **`ADVANCE_CREDIT`** (day status) and **`ADVANCED`** (credit status) use `info` plus a "⏩" icon. They mean "credited before the data arrived", not "present". Use the label "Advance credit" for the day and "Advanced" for the credit.
- **`ENDORSED`** uses `info`, with the label "Endorsed, waiting for HR".
- The **advance credit lifecycle** reads left to right in one tone family: Advanced (info) → Reconciled (success) / Adjusted (warning) / Reversed (danger), or Cancelled (neutral).
- **Make-up outcome**: Awaiting make-up (info) → Attended (success) / Partial (warning) / Not attended (danger). The request status (PENDING / APPROVED …) is a separate badge.
- **Attendance basis chip** (ADR-26), shown next to the day status on HR and employee screens. It is never printed.
  - `ACTUAL`: no chip
  - `SCHEDULE_DERIVED`: neutral chip "From schedule"
  - `ADVANCE`: info chip "Advance"
  - `MIXED`: neutral chip "Mixed"
- No new colour tokens. All new badges map to the existing semantic tokens in §2.

## 4. Layout and navigation

```
┌──────────────────────────────────────────────────────────────┐
│ CVSU DTR   [Period: Oct 1–15, 2026 ▾]        🔔  Juan ▾      │
├──────────────┬───────────────────────────────────────────────┤
│ Sidebar      │ Page title · short description   [Primary]    │
│ (role-based) │ Filters / tabs                                │
│              │ Content (table / form / detail)               │
└──────────────┴───────────────────────────────────────────────┘
```
- The **global period selector** in the header sets the default period filter everywhere. *(v3)* It lists **semi-monthly** periods ("Oct 1–15, 2026", "Oct 16–31, 2026"), newest first.
- Mobile: header + bottom navigation for employees; drawer navigation for HR. Wide HR tables scroll horizontally instead of turning into cards.
- A user with several roles sees grouped sections (MY WORK, DEPARTMENT, HR, ADMIN).

## 5. Route map

| Route | Roles | Screen | Primary action |
|---|---|---|---|
| `/login`, `/accept-invite`, `/reset-password` | public | Auth | Sign in |
| `/` | all | Role-aware home | (depends on role) |
| `/me/attendance` | EMPLOYEE | My attendance (month grid/table) | — |
| `/me/schedule` | EMPLOYEE | My schedule (weekly blocks, status) | Submit schedule |
| `/me/dtrs`, `/me/dtrs/:id` | EMPLOYEE | My DTRs + CSC-48-style preview (v3: advance days, prior-period adjustments, §6.13) | Confirm DTR / Download PDF |
| `/me/requests`, `/me/requests/new` *(v3, P1B)* | EMPLOYEE | My requests (Offset · Wellness · Make-up class · Earned offset) with offset balance and wellness days left (§6.16) | New request |
| `/dept/approvals` *(v3, P1B)* | DEPARTMENT_HEAD (Dean via scope) | Approvals inbox, level 1: endorse Offset/Wellness and schedules; approve Make-up class and earned offset (§6.15) | Endorse / Approve |
| `/dept/schedules` | DEPARTMENT_HEAD | Schedule approval queue (v3: the Schedules tab of `/dept/approvals`, **endorse** instead of approve) | Endorse |
| `/dept/attendance` | DEPARTMENT_HEAD | Department attendance (read-only) | — |
| `/hr` | HR_* | **Needs Attention** dashboard | (item links) |
| `/hr/imports`, `/hr/imports/new`, `/hr/imports/:id` | HR_* | Imports list, wizard, detail (v3: reconciliation summary, §6.12) | Upload & validate / Commit |
| `/hr/biometric-mapping` | HR_* | Unmatched IDs → map to employee | Map |
| `/hr/processing` | HR_* | Process period, job history | Process period |
| `/hr/attendance` | HR_* | Attendance review table + detail drawer | — |
| `/hr/exceptions` | HR_* | Exceptions (pending / all). v3: also `ASYNCHRONOUS` and the Phase 1 paper-request stop-gap (§6.14) | New exception / Approve |
| `/hr/approvals` *(v3, P1B)* | HR_ADMIN (HR_STAFF S for schedules) | Approvals inbox, level 2: approve **endorsed** Offset/Wellness and schedules (§6.15) | Approve |
| `/hr/dtrs`, `/hr/dtrs/:id` | HR_* | DTR queue by status, DTR detail | Validate / Finalize / Receive |
| `/hr/schedules` | HR_* | All schedules, templates | New schedule |
| `/hr/employees`, `/hr/employees/:id` | HR_* | Employees, biometric IDs, bulk import. v3: **Schedule blocks** tab (per-employee blocks in Phase 1); **Balances** tab (offset ledger, wellness used, P1B) | Add employee |
| `/hr/periods`, `/hr/calendar`, `/hr/rule-sets` | HR_ADMIN | Periods (v3: semi-monthly, "Create both halves"), holidays/suspensions/**government announcements**, rule sets (+ simulator) | New … |
| `/hr/periods/:id` *(v3)* | HR_* (edit: HR_ADMIN) | Period page: status, planned advance date, processing runs, **advance-processing dialog** (§6.10) | Run advance processing |
| `/hr/periods/:id/advance-credits` *(v3)* | HR_* | Advance credits for the period + history drawer (§6.11) | — |
| `/reports/*` | DEPT_HEAD, HR_* | Reports | Generate |
| `/admin/users`, `/admin/departments`, `/admin/devices`, `/admin/audit` | SYSTEM_ADMIN (audit also HR_ADMIN) | Administration | Invite user |

Frontend route guards are for UX only. The API enforces access.

## 6. Key screens

### 6.1 Employee home
```
Good morning, Juan                                   Oct 1–15, 2026
┌───────────────────────────────────────────────────────────────┐
│ Your DTR: DRAFT — please review and confirm by Oct 20         │
│ [ Review my DTR ]                                             │
└───────────────────────────────────────────────────────────────┘
This period  Present 9 · Late 2 (23 min) · Undertime 0 · Advance 2 days · Needs action 1
Today        Schedule 8:00 AM – 12:00 PM, 1:00 – 5:00 PM · Punches 7:56 AM
```
The top banner always shows the **next required action** for the current DTR status:
DRAFT → "Review and confirm", RETURNED → "Returned: <reason>", FINALIZED → "Download, print, sign, submit to HR", RECEIVED → "Done ✓".
*(v3, P1B)* A second line shows request updates, e.g. "Wellness Oct 9 endorsed, waiting for HR". When the next DTR has a deduction from an earlier period, it says so: "Sept 15 advance credit reversed: −10h 0m on this DTR". The submission deadline (⚠ BUSINESS-RULES Q15) applies per semi-monthly period.

### 6.2 My DTR (CSC Form 48 preview)
```
DTR — Oct 1–15, 2026 · v1 · FOR REVIEW
┌─────┬──────────┬──────────┬──────────┬──────────┬───────────┬─────────────┐
│ Day │ AM In    │ AM Out   │ PM In    │ PM Out   │ Undertime │ Remarks     │
├─────┼──────────┼──────────┼──────────┼──────────┼───────────┼─────────────┤
│ 1 Th│ 7:52 AM  │ 12:01 PM │ 12:58 PM │ 5:03 PM  │           │             │
│ 2 F │ 8:15 AM  │ 12:00 PM │ 1:00 PM  │ 5:00 PM  │ 0h 15m    │ Late ⓘ      │
│ 3 Sa│          │          │          │          │           │ Rest day    │
│ 5 M │ 8:10 AM  │ —        │ —        │ —        │ 0h 10m    │ ⚠ Missing out│
└─────┴──────────┴──────────┴──────────┴──────────┴───────────┴─────────────┘
Totals  Tardy 2× / 25 min · Undertime 25 min · Absences 0
[ Confirm DTR ]   [ Report a problem ]            (Download PDF appears at FINALIZED)
```
- `ⓘ` opens a **"Why?"** popover with the calculation trace (schedule, punches used/ignored, rule applied).
- *(v3)* The grid shows only the period's days (1–15 or 16–end). Advance days and the prior-period adjustments section are shown as in §6.13.
- "Report a problem" opens a short form (date, slot, explanation, optional attachment). In Phase 1 it creates a note for HR; in Phase 2 it creates an exception request.
- After FINALIZED, a checklist: **1 Download → 2 Print → 3 Sign → 4 Have In-Charge sign → 5 Submit to HR**, with "Mark as submitted" and a note that the paper copy is still required.

### 6.3 My schedule
- Weekly grid (Mon–Sun) with blocks, **template picker** first ("Regular 8–5"), then "Customize".
- Inline validation: overlap, start ≥ end, outside the semester.
- Status banner: DRAFT / SUBMITTED (waiting for <Department Head>) / *(v3)* ENDORSED (waiting for HR) / APPROVED / REJECTED (reason **and level**: "Rejected by Department Head" or "Rejected by HR") / locked for finalized periods.
- *(v3)* A mid-semester change starts a new version with an **effective date** (⚠ O-3). The banner shows "Current: v2 (approved) · Pending: v3 from Nov 3 (endorsed)".
- *(v3, Phase 1)* HR enters per-employee blocks for faculty in the same weekly editor on `/hr/employees/:id` (Schedule blocks tab). They are saved directly as APPROVED. The editor shows the derived AM/PM **group** start and end, because tardiness is measured from the group start (ADR-32).

### 6.4 HR "Needs Attention"
```
Oct 1–15, 2026 · Period OPEN · advance processing planned Oct 13 · deadline Oct 20

Needs attention
  ⚠ Suspected data gap: Sept 29 — 142 of 180 credits reversed   → Review import #57
  1  reconciliation run failed (import #55)          → Retry
  3  unmatched biometric IDs (212 punches)          → Map IDs
  14 days with missing punches (blocking)            → Review
  6  employees without an approved schedule          → View
  5  exceptions waiting for approval                 → Approve
  4  requests endorsed, waiting for HR approval      → Approve       (P1B)
  180 advance credits not reconciled yet (Sept 30: no import covers it) → View
  Advance processing planned Oct 13 (in 4 days)      → Open period
  20 DTRs for review · 8 validated, not finalized    → Open queue
  120 finalized DTRs not yet received                → Track

Recent: Import #57 committed (Sept 21–29 · 1,185 new, 312 duplicates) · Credits reconciled 31 · adjusted 7 · reversed 142 · Processing ran 10:42 AM (OK)
```
Every row links to a pre-filtered list. There are no vanity charts.

*(v3)* Order and rules of the new items:
- **Suspected data gap** and **reconciliation failed** come first, because they can deduct many employees by mistake (analysis §8.2). The threshold is defined in BUSINESS-RULES §12. The row links to the import result (§6.12).
- **Advance credits not reconciled yet**: credits still `ADVANCED` for dates that have passed. This means no committed import covers the date yet (ADR-24). The row links to §6.11, filtered to `ADVANCED`.
- **Advance processing planned**: shown from 3 days before the period's `planned_advance_date` until an ADVANCE run exists for the period.
- **Requests endorsed, waiting for HR** (P1B): HR_ADMIN only.

### 6.5 Import wizard (dedicated page)
`1 Select device → 2 Upload file → 3 Validation summary → 4 Review errors → 5 Commit → 6 Done (next: Process period)`

*(v3)* Step 6 shows the **reconciliation summary** (§6.12) when the batch covers any advance-credited date.

Summary:
```
attendance_oct_w2.xlsx · Device MAIN-ADMIN-01 · Oct 1 – Oct 14, 2026
Rows 4,812 · Valid 4,790 · Invalid 22 · Already imported 3,905 · New 885 · Unmatched IDs 2
⚠ A file with the same content was imported on Oct 9 (#38).
[ Review 22 errors ]  [ Discard ]                         [ Commit 885 new punches ]
```

### 6.6 Attendance review (HR)
- Table: Employee · Date · Schedule · AM In · AM Out · PM In · PM Out · Tardy · Undertime · Status · Flags.
- Quick filters: *Blocking only*, *Late*, *Absent*, *No schedule*, department, employee search.
- Row → **right drawer**: expected vs actual, punches (used/ignored with reason), exceptions applied, trace, and actions *Add exception*, *Reprocess this employee*.

### 6.7 DTR queue (HR)
- Tabs by status with counts: Draft · For review · Validated · Returned · Finalized · Submitted · Received.
- Bulk select → **Validate** / **Finalize** / **Receive**. The result dialog lists successes and failures with reasons (e.g., "Has 2 blocking days").
- Detail page = the same CSC-48 preview + status history timeline + documents (versions, hash code).
- Confirmation dialogs use explicit labels: "Finalize 25 DTRs?", "After finalizing, attendance for these employees and dates is locked." [Cancel] [Finalize 25 DTRs].

### 6.8 Exceptions
- The form adapts to the type: Leave (subtype, whole/AM/PM, date range), OB (range/time), Time correction (slot + time), Missing-punch certification (slot + time + attachment).
- *(v3)* More types: **Asynchronous** (whole day only, no approval step, §6.14), and in Phase 1B **Offset / Wellness / Make-up class** (§6.16).
- Approval list shows the requester and flags "You created this — another HR Admin must approve" (maker-checker). *(v3)* It also shows the endorser, and flags "You endorsed this — another HR Admin must approve" if the same person holds both roles.

### 6.9 Rule-set simulator (HR_ADMIN)
Choose employee + date (+ draft rule set) → see the calculation trace side by side with the current published result. This is used to check policy changes before publishing.

### 6.10 Period page and advance processing (v3, Phase 1)
Route `/hr/periods/:id`. Rules: BUSINESS-RULES §12, ADR-22.
```
Oct 1–15, 2026 · OPEN · Planned advance date Oct 13              [ Run advance processing ]
Tabs: Overview · Processing runs · Advance credits (2,024) · DTRs

Processing runs
  #81  ADVANCE  until Oct 13 · M. Cruz · Oct 13, 9:02 AM · SUCCEEDED · 1,012 employees · 2,024 credits
  #77  FULL     Oct 1 – Oct 12 · M. Cruz · Oct 12, 4:40 PM · SUCCEEDED
  #79  RECONCILIATION  import #57 · system · Oct 9, 10:42 AM · SUCCEEDED · 180 credits
```
**Advance-processing dialog**
```
Run advance processing — Oct 1–15, 2026
Process actual attendance until *   [ Tue, Oct 13, 2026 ▾ ]     Allowed: Oct 1 – Oct 14
Days after this date get advance credit from each employee's approved schedule.

Preview
  From punches           Oct 1 – Oct 13
  Advance credit         Oct 14 – Oct 15 (2 working days)
  Employees credited     1,012
  Credit-days            2,024
  No approved schedule   6 employees: no credit, stays blocking            → View list
  Already credited       0 dates

ⓘ Advance days print with the schedule times and no remark (HR decision D-HR-05).
  If the employee turns out late or absent, the difference is deducted on the next DTR.
[ Cancel ]                                        [ Credit 2,024 days for 1,012 employees ]
```
- The date picker allows only `period start ≤ date < period end`. It defaults to the planned advance date.
- The preview refreshes whenever the date changes. The primary button states the exact counts.
- Running again with a later date shows the dates that are already credited and how they will be handled (no duplicates, BUSINESS-RULES §12).
- While the run is in progress, the long-job pattern applies (§7). The result banner links to the advance-credits tab.
- Phase 1 role: HR_ADMIN. Full design: HR_STAFF in scope or HR_ADMIN ([[CVSU-DTR/v3/API-DESIGN#4. Roles and permissions|API-DESIGN §4]]).

### 6.11 Advance credits and their history (v3)
Route `/hr/periods/:id/advance-credits`. The list is Phase 1; the history drawer ships with reconciliation (Phase 1 follow-up).
```
Advance credits — Oct 1–15, 2026      [Status: All ▾] [Department ▾] [Date ▾] [Search employee]
Advanced 1,850 · Reconciled 120 · Adjusted 31 · Reversed 23 · Cancelled 0
┌──────────────────┬──────────────┬──────────┬────────────┬────────────┬──────────────────┐
│ Employee         │ Date         │ Credited │ Status     │ Adjustment │ Applied in       │
├──────────────────┼──────────────┼──────────┼────────────┼────────────┼──────────────────┤
│ Reyes, Ana       │ Thu, Oct 15  │ 10h 0m   │ Reversed   │ −10h 0m    │ Oct 16–31, 2026  │
│ Santos, Leo      │ Thu, Oct 15  │ 8h 0m    │ Adjusted   │ −30 min    │ Oct 16–31, 2026  │
│ Cruz, Mia        │ Wed, Oct 14  │ 8h 0m    │ Reconciled │ 0          │ —                │
│ Lim, Paolo       │ Wed, Oct 14  │ 8h 0m    │ Advanced   │ —          │ —                │
└──────────────────┴──────────────┴──────────┴────────────┴────────────┴──────────────────┘
```
Row → **history drawer** (read-only, append-only `advance_credit_events`):
```
Reyes, Ana · Thu, Oct 15, 2026 · credited 10h 0m
Schedule 7:00 AM – 12:00 PM, 2:00 – 7:00 PM
Status: Reconciled · net 0 (−10h 0m, then +10h 0m) · applied in Oct 16–31, 2026

History
● Oct 13, 9:02 AM    CREATED     → Advanced              advance run #81 · M. Cruz
● Oct 19, 2:15 PM    REVERSED    Advanced → Reversed     −10h 0m · import #60 · system · no punches
● Oct 22, 10:01 AM   RESTORED    Reversed → Reconciled   +10h 0m · Wellness approved (#E-311) · system

[ Open processed day ]   [ View raw punches ] (audited)
```
- The status counts above the table are quick filters.
- The drawer has **no edit or delete actions**. Corrections happen only through new events: a later import with punches for the date (which can restore a reversal, ADR-24), an approved request, or a manual re-run.
- When the adjustment was carried forward, the drawer links to the matching `carry_forward_adjustments` row and the DTR it landed on.
- A separate **Unapplied adjustments** filter lists adjustments with no target period, e.g. for separated employees (BUSINESS-RULES §12.9). HR settles them outside the system ⚠.
- HR_ADMIN sees **Re-run reconciliation for this date** in the overflow menu (Phase 1 follow-up). It needs a reason and adds a `MANUAL` event.
- Each event shows who did it, or "system" for automatic events, and links to its source (run, import, request).

### 6.12 Reconciliation summary on the import result (v3, Phase 1 follow-up)
Shown in step 6 of the import wizard and on `/hr/imports/:id` when the batch covers advance-credited dates (ADR-24).
```
Import #57 · COMMITTED · Sept 21 – Sept 29, 2026 · 1,185 new punches

Advance credits reconciled by this import
┌───────────────┬──────────┬────────────┬──────────┬──────────┬────────────┐
│ Date          │ Credited │ Reconciled │ Adjusted │ Reversed │ Restored │ Net        │
├───────────────┼──────────┼────────────┼──────────┼──────────┼──────────┼────────────┤
│ Tue, Sept 29  │ 180      │ 31         │ 7        │ 142 ⚠    │ 0        │ −1,423h    │
└───────────────┴──────────┴────────────┴──────────┴──────────┴──────────┴────────────┘
⚠ Suspected data gap on Sept 29: 142 of 180 credited employees (79%) have no punches.
  This often means the export is missing a day or the device was offline.
  [ View reversed credits ]   [ Import the missing export ]

Not covered by this import: Sept 30 (180 credits stay Advanced).
Only employees mapped to device MAIN-01 were reconciled.
Deductions go to each employee's next open DTR (Oct 1–15, 2026).
```
- Only credits **inside the batch's detected date range** (`detected_date_from` to `detected_date_to`) and for employees **mapped to the batch's device** are reconciled (ADR-24). The summary says which dates and which device, so HR can see what was not touched.
- The data-gap threshold is a rule (BUSINESS-RULES §12). The UI only shows the flag.
- **Recovery:** importing the missing export re-evaluates the affected credits automatically. Reversed credits that now have punches are restored (event `RESTORED`), and the new import's summary shows a **Restored** column. HR_ADMIN can also re-run reconciliation by hand from §6.11.
- A reconciliation that is still running shows a progress bar. A failed run shows a persistent `danger` banner with **Retry**, and the import stays committed.
- ⚠ *Optional, if the API offers a dry run:* the step 3 validation summary also predicts the result before commit, e.g. "Committing will reconcile 180 credits for Sept 29: about 142 would be reversed." That gives HR a chance to check the export first.

### 6.13 DTR preview: advance days and prior-period adjustments (v3)
Applies to `/me/dtrs/:id` (Phase 1B) and `/hr/dtrs/:id` (Phase 1).
```
DTR — Oct 1–15, 2026 · Reyes, Ana · v1 · DRAFT      Actual until Oct 13 · Advance Oct 14–15
┌───────┬──────────┬──────────┬──────────┬──────────┬───────────┬─────────┬───────────┐
│ Day   │ AM In    │ AM Out   │ PM In    │ PM Out   │ Undertime │ Remarks │ (screen)  │
├───────┼──────────┼──────────┼──────────┼──────────┼───────────┼─────────┼───────────┤
│ 13 Tu │ 7:05 AM  │ 12:00 PM │ 1:58 PM  │ 7:01 PM  │ 0h 5m     │         │ Late ⓘ    │
│ 14 W  │ 7:00 AMˢ │ 12:00 PMˢ│ 2:00 PMˢ │ 7:00 PMˢ │           │         │ ⏩ Advance │
│ 15 Th │ 7:00 AMˢ │ 12:00 PMˢ│ 2:00 PMˢ │ 7:00 PMˢ │           │         │ ⏩ Advance │
└───────┴──────────┴──────────┴──────────┴──────────┴───────────┴─────────┴───────────┘
Totals  Tardy 1× / 5 min · Undertime 5 min · Absences 0 · Advance credit 2 days (20h 0m)

Prior-period adjustments (from earlier, finalized DTRs)               [ + Manual adjustment ] (HR_ADMIN)
┌────────────────┬────────────────┬──────────────────────────────────────┬──────────┐
│ Original date  │ Source         │ Reason                               │ Minutes  │
├────────────────┼────────────────┼──────────────────────────────────────┼──────────┤
│ Tue, Sept 29   │ Advance credit │ Reversed: no punches (absent)        │ −10h 0m  │
│ Mon, Sept 28   │ Advance credit │ Adjusted: late 30 min                │ −30 min  │
│ Fri, Sept 4    │ Late exception │ Make-up letter approved: restored    │ +2h 0m   │
│ Thu, Sept 24   │ Manual         │ HR correction, memo 2026-114 (M. Cruz)│ −30 min  │
└────────────────┴────────────────┴──────────────────────────────────────┴──────────┘
Total prior-period adjustment   −9h 0m
```
- The **Remarks** column mirrors the printed form, so it stays blank for advance days (D-HR-05). The extra **(screen)** column shows the day status and attendance-basis chip. It is never printed.
- Schedule-derived times use the "sched" marker (§2). Their tooltip says "From schedule: advance credit (not a punch)".
- After reconciliation, the HR detail page shows each advance day's credit status (Reconciled / Adjusted / Reversed) and links to the history drawer (§6.11). A finalized DTR never changes; the result appears on the next DTR.
- The section lists the rows of the `carry_forward_adjustments` ledger applied to **this** period, whatever the source: `ADVANCE_CREDIT`, `MAKEUP_CLASS`, `LATE_EXCEPTION` (an exception or letter approved after its DTR was finalized) or `MANUAL` (ADR-25). The total equals `prior_period_adjustment_minutes`, the sum of these rows. Each row links to its source (credit history, make-up request, exception).
- Rows are **append-only**, so there is no edit or delete action. A wrong row is fixed by a new opposite row.
- **+ Manual adjustment** (HR_ADMIN only, Phase 1 follow-up): original date, ± minutes, and a required reason/reference in a ConfirmDialog ("Add −30 min to Reyes, Ana's Oct 1–15 DTR?"). It is audit-logged (SECURITY-PRIVACY §5.3). It is hidden for other roles and refused by the API.
- An adjustment never lands on its own period while that DTR is still open. In that case the day itself is recalculated and shows the actual punches instead (ADR-25).
- **Print view** toggle: shows exactly what the PDF will contain, with no markers or screen column.
- Where the adjustments appear on the printed form depends on the official template (REQUIREMENTS B7). Until then, they print as a total line under the totals ⚠.

### 6.14 HR day remarks, Asynchronous and government announcements (v3, Phase 1)
- The **Add day remark** dialog (DTR detail or attendance drawer) gains these types:
  - **Asynchronous**: whole day only, so there is no AM/PM choice. A memo attachment is optional. Help text: "Credited from the schedule. No approval step. Logged as entered by you."
  - **Paper-approved Offset / Wellness / Make-up class** (stop-gap until Phase 1B). Required fields: approved by (name and position), approval date, reference number. A scan of the signed form is optional ⚠. A banner says "Phase 1 does not check the offset balance or the wellness limit. Check the paper record." For Make-up class, HR also enters the original date and block and the make-up date and times. The note says "Check the make-up date's punches yourself in Phase 1."
- **Calendar → New event → Government announcement**:
  - date;
  - whole day, or **from** a start time (partial day);
  - memo/reference number;
  - scope, fixed to "All employees (government-wide)" and shown read-only (D-HR-11).
- Saving any of these marks the affected days stale. A toast offers **Reprocess affected days**.

### 6.15 Approvals inbox (v3, Phase 1B)
Department Head / Dean: `/dept/approvals`. HR: `/hr/approvals`. Rules: BUSINESS-RULES §8, §6; ADR-28.
```
Approvals · College of Engineering (3 departments)              [Type ▾] [Department ▾]
Tabs: Requests (7) · Schedules (2) · Earned offset (3)
┌────────────────┬───────────┬─────────────────────────┬───────────┬──────────────────────────┬────────────┐
│ Employee       │ Type      │ Date(s)                 │ Time      │ Checks                   │ Action     │
├────────────────┼───────────┼─────────────────────────┼───────────┼──────────────────────────┼────────────┤
│ Reyes, Ana     │ Wellness  │ Fri, Oct 23             │ Whole day │ 2 of 4 days used ✓       │ Endorse ▾  │
│ Santos, Leo    │ Offset    │ Mon, Oct 26 (AM)        │ 5h 0m     │ Balance 2h 0m ✗          │ Reject     │
│ Cruz, Mia      │ Make-up   │ Thu, Oct 8 → Sat, Oct 17│ 2h 0m     │ Letter ✓                 │ Approve ▾  │
└────────────────┴───────────┴─────────────────────────┴───────────┴──────────────────────────┴────────────┘
```
- **Department Head / Dean** (level 1):
  - **Endorse** or **Reject** Offset, Wellness and schedules;
  - **Approve** or **Reject** Make-up class and earned-offset claims (Head-only level).
  - The button label always names the level: "Endorse (HR approves next)" or "Approve (final)".
- **HR** (level 2) sees only **ENDORSED** items, with "Endorsed by / at" columns, and can **Approve** or **Reject**.
- **Detail drawer**:
  - the request and the reason;
  - the attachment preview (letter or proof, opened through the authorized file endpoint);
  - the employee's processed attendance for the date(s);
  - for earned offset, the raw punches of the claimed date (audited). A mismatch shows a `warning`, not a block (⚠ O-5).
  - the balance or limit check, and the history: requested → endorsed → approved/rejected, with names and remarks.
- **Maker-checker**: the reviewer's own requests (and, for HR, requests they endorsed) are shown with actions disabled: "You can't review your own request." The API enforces this (`MAKER_CHECKER_VIOLATION`).
- **Rejection** needs a reason, in a ConfirmDialog. The employee sees the reason and the level.
- If the date is in a finalized DTR, approval shows "Oct 8 is in a finalized DTR. The effect goes to the next open DTR (Oct 16–31) as a prior-period adjustment."
- The limit and balance are checked again at each level. Error codes map to plain messages:
  - `WELLNESS_LIMIT_REACHED`: "Wellness limit reached: 4 of 4 days used in AY 2026–2027."
  - `OFFSET_BALANCE_INSUFFICIENT`: "Not enough offset balance: 2h 0m available, 5h 0m requested."
- Out-of-scope items never appear, and a direct link returns the standard not-found page (404).

### 6.16 My requests, balances and the make-up form (v3, Phase 1B)
Route `/me/requests`.
```
My requests                                                        [ New request ]
┌───────────────────────────────┐ ┌───────────────────────────────┐
│ Offset balance                │ │ Wellness days left            │
│ 6h 30m · 1st Sem 2026–2027    │ │ 2 of 4 · AY 2026–2027         │
│ Expires at semester end       │ │ (1 pending)                   │
└───────────────────────────────┘ └───────────────────────────────┘
Tabs: Requests · Earned offset · Offset ledger
Requests: Type · Date(s) · Status · Reviewer · Make-up outcome · Updated     (Cancel while Pending/Endorsed)
```
**New request** (type first, then the form adapts):
- **Wellness**: a date or date range of **whole days only**, so there is no AM/PM control. The form shows "Uses 1 day · 1 left after approval". Going over the limit shows an inline error, and Submit is disabled (`WELLNESS_LIMIT_REACHED`).
- **Offset**: a date and what it covers (whole day / AM / PM / one class block). The minutes are calculated from my schedule. The balance is shown next to them, and Submit is disabled when the balance is too low (`OFFSET_BALANCE_INSUFFICIENT`).
- **Make-up class**: the original date, then **pick the missed class block** from my schedule. Then the make-up date, start and end time, and room. **Letter (required)**: a FileDropzone with the allowed types and size from [[CVSU-DTR/v3/API-DESIGN#8. Files|API-DESIGN §8]]. Submit stays disabled until the letter is uploaded (`MAKEUP_LETTER_REQUIRED`). Help text: "Your Department Head approves this. Until it is approved, the original date counts as absent. You must punch in and out on the make-up date."
- **Earned offset claim**: the work date, from/to time and reason, and an optional proof file. "Your Department Head or Dean approves this. The hours expire at the end of the semester."
- Server errors are mapped by `error.code`, as in the inline checks above. The inline checks are a convenience; the API decides.
- The **Offset ledger** tab lists `EARNED +`, `USED −`, `EXPIRED −` and `REVERSED` entries with dates and the linked request.
- At 360 px the two balance cards stack, and the requests table becomes a list (employee screens only, §4).

## 7. Feedback states (every page)
| State | Pattern |
|---|---|
| Loading | Skeleton for known layouts; button spinner + disabled for actions ("Finalizing…") |
| Empty | What happened + what to do ("No attendance yet for October. Import a file to begin." [Go to imports]) |
| Error | Human message + retry + request ID in small text for support |
| Success | Toast for short confirmations; persistent banner for results users need later (import summary) |
| Long job | Progress bar with `done/total`; the user can leave the page; a notification bell entry appears when done. *(v3)* Advance runs and the reconciliation after an import commit use the same pattern. |
| Partial failure (v3) | The import committed but reconciliation failed: a persistent `danger` banner on the import result with **Retry**, plus a "Needs Attention" row. The committed punches are never rolled back by the UI. |

## 8. Forms
- Visible labels (never placeholder-only), required `*`, help text under fields, inline errors next to fields.
- Keyboard: logical tab order; Enter submits primary; Esc closes dialogs/drawers.
- Destructive or irreversible actions need a confirmation with the consequence stated; returns, rejects and reopens need a reason.

## 9. Printing and PDF
- The official output is the **PDF from the server** (CSC Form 48). The on-screen preview mirrors its columns but is not the official document.
- A print stylesheet exists for report pages. The DTR "Print" button opens the PDF, not the HTML page.
- The PDF footer shows the version and verification code (STACK §7).
- *(v3)* One PDF per **semi-monthly** period (D-HR-17). Only the period's days are filled. How the other rows look follows the official template (REQUIREMENTS B7).
- *(v3)* **Advance days print like normal days**: the scheduled AM/PM group times, no marker and no remark (D-HR-05, ADR-22). This is an HR decision that HR must confirm in writing (REQUIREMENTS B9, SECURITY-PRIVACY §5.1). The "sched" marker, the attendance-basis chip and the (screen) column are **screen-only**. ⚠ If HR asks for it, add an optional footer note, "Includes advance credit".
- *(v3)* Carry-forward rows from `carry_forward_adjustments` print as a "Prior-period adjustment" line with the total `prior_period_adjustment_minutes` (position per B7 ⚠).

## 10. Accessibility (WCAG 2.1 AA principles)
Contrast ≥ 4.5:1 for text, visible focus ring, semantic tables (`<th scope>`), accessible dialogs (focus trap, labelled), `aria-live` for job progress and toasts, touch targets ≥ 44 px on mobile, status never conveyed by color alone, and a zoom-to-200% layout check.

## 11. Performance on low-end devices
- Route-level code splitting; the initial JS for the employee area stays small (target < 200 KB gzipped).
- Server-side pagination for every HR table; no loading an entire month for all employees in the browser.
- Test on a low-end Android phone over 3G throttling.

## 12. Component inventory
`Button, IconButton, Input, Select, Combobox (employee search), DatePicker, TimeInput (12h UI / 24h value), Textarea, Checkbox, RadioGroup, Badge/StatusBadge, Table (TanStack), Pagination, Tabs, Drawer, Dialog/ConfirmDialog, Toast, Banner, Skeleton, EmptyState, ErrorState, FileDropzone, Stepper (wizard), ProgressBar, Timeline (status history), Tooltip/Popover (trace), PeriodSelector, DtrGrid (CSC-48 preview)`

*(v3)* Shared additions: `AttendanceBasisChip`, `SignedMinutes` (± with tone), `BalanceCard`, and a `ScheduleDerivedTime` variant of the time cell. `Timeline` is reused for the credit history and the approval history.

Feature components live in `features/<feature>/components` (e.g., `AttendanceDrawer`, `ImportSummary`, `ScheduleWeekEditor`, `DtrQueueTable`). *(v3)* For example: `AdvanceProcessingDialog`, `AdvanceCreditTable`, `CreditHistoryDrawer`, `ReconciliationSummary`, `PriorPeriodAdjustments`, `ManualAdjustmentDialog`, `ApprovalInbox`, `RequestForm`, `MakeUpLetterUpload`.

## 13. Definition of done for a screen
- [ ] Title, description and one primary action
- [ ] Loading, empty, error and success states
- [ ] Works at 360 px width (employee screens) and 1280 px (HR)
- [ ] Keyboard-only walkthrough passes; focus visible
- [ ] All times 12-hour; all minutes formatted; statuses use StatusBadge
- [ ] No hard-coded colors or spacing outside tokens
- [ ] Permission-hidden actions are also rejected by the API (checked in an E2E test)
- [ ] *(v3)* Schedule-derived and advance values are visibly marked on screen and never look like punches; the print view shows exactly what the PDF prints
- [ ] *(v3)* Approval actions name their level (Endorse vs Approve) and are disabled for the requester/endorser
