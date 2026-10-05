---
title: CVSU DTR — Documentation v3 (Index)
version: 3.0
status: draft
updated: 2026-10-05
supersedes: CVSU-DTR v2 (CVSU-DTR/v2/)
source_of_changes: "[[CVSU-DTR/HR-Requirements-Analysis]]"
---

# CVSU DTR Management and Attendance Processing System — v3

A web system that imports biometric attendance, applies CvSU attendance rules, and produces the government-format **Daily Time Record (CSC Form No. 48)**. The system prepares and validates the DTR; employees still print it and sign it by hand.

> [!info] What's new in v3
> v3 is v2 plus the **HR (client) requirements** of 2026-10-05: [[CVSU-DTR/Requirements-ERD-and-Table Schema.md|HR requirements]], analysed and answered in [[CVSU-DTR/HR-Requirements-Analysis|HR-Requirements-Analysis]].
> The headline changes:
> - **semi-monthly** DTR periods;
> - **advance DTR processing** with **advance credits** and automatic **reconciliation**;
> - new attendance reasons: **Asynchronous, Government Announcement, Offset, Wellness, Make-up Class**;
> - **two-level approval** (Department Head → HR);
> - an **offset balance** and a **wellness limit**.
>
> The decisions are **ADR-21 to ADR-32** below. The HR decision IDs (`D-HR-xx`) refer to the analysis document.

> [!important] Rule for these docs
> Each fact appears **in one document only**. Other documents link to it. If you change a decision, update the owning document and the decision log below.

---

## 1. Document map

| Read order | Document | Owns |
|---|---|---|
| 0 | [[CVSU-DTR/HR-Requirements-Analysis\|HR-Requirements-Analysis]] | **Why v3 exists:** HR's requirements, answers and decisions (D-HR-01 … D-HR-25) |
| 0 | [[CVSU-DTR/v3/00-REVIEW-AND-RECOMMENDATIONS\|Review of v1]] | Why v2 exists (history) |
| 1 | [[CVSU-DTR/v3/REQUIREMENTS\|REQUIREMENTS]] | Scope, MVP, user stories, acceptance criteria |
| 2 | [[CVSU-DTR/v3/BUSINESS-RULES\|BUSINESS-RULES]] | Attendance calculations, all lifecycles/state machines, open HR questions |
| 3 | [[CVSU-DTR/v3/ARCHITECTURE\|ARCHITECTURE]] | System shape, data flow, deployment |
| 4 | [[CVSU-DTR/v3/MODULES\|MODULES]] | NestJS module boundaries and dependencies |
| 5 | [[CVSU-DTR/v3/DATABASE-MAPPING\|DATABASE-MAPPING]] | Tables, columns, constraints, indexes |
| 6 | [[CVSU-DTR/v3/API-DESIGN\|API-DESIGN]] | Endpoints, roles/permissions, errors |
| 7 | [[CVSU-DTR/v3/DESIGN-PATTERNS\|DESIGN-PATTERNS]] | Which patterns, where, and why |
| 8 | [[CVSU-DTR/v3/STACK\|STACK]] | Technology choices and versions |
| 9 | [[CVSU-DTR/v3/UI_DESIGN\|UI_DESIGN]] | Screens, routes, visual rules |
| 10 | [[CVSU-DTR/v3/SECURITY-PRIVACY\|SECURITY-PRIVACY]] | Auth, RA 10173, retention, backups |
| 11 | [[CVSU-DTR/v3/DEVELOPMENT-PHASES\|DEVELOPMENT-PHASES]] | Roadmap, sprints, milestones, DoR/DoD, RACI, risks |
| 12 | [[CVSU-DTR/v3/PHASE1-MVP-1-MONTH\|PHASE1-MVP-1-MONTH]] | **Current plan:** 1-month Phase 1 (export → import → generate → download), deadline Oct 30, 2026 |
| — | [[CVSU-DTR/v3/PHASE1-E2E-FLOW.canvas\|PHASE1-E2E-FLOW (canvas)]] | Visual end-to-end flow of Phase 1 |
| — | [[CVSU-DTR/v3/HR-PROCESS-FLOW.canvas\|HR-PROCESS-FLOW (canvas)]] | Visual swimlane flow of the whole HR cycle + DTR status lifecycle |

---

## 2. Canonical decisions (ADR log)

| ID | Decision | Reason | Owner doc |
|---|---|---|---|
| ADR-01 | Modular monolith (NestJS) + React SPA | Small team, one deployable, clear boundaries | ARCHITECTURE |
| ADR-02 | PostgreSQL is the only system of record | Relational integrity, reporting | DATABASE-MAPPING |
| ADR-03 | **Raw punches are append-only**, enforced by DB grants; employee matching happens at processing time | Raw data is evidence; mapping can change | DATABASE-MAPPING §6 |
| ADR-04 | **Processed attendance is derived and fully rebuildable** from raw punches + approved schedules + approved exceptions + calendar + rule set | Rule changes and corrections without data loss | BUSINESS-RULES §2 |
| ADR-05 | Attendance is processed **per DTR period**, not per import file | Exports overlap | BUSINESS-RULES §3 |
| ADR-06 | Record-level dedup: `UNIQUE(device_id, biometric_identifier, punched_at)` | File hashes don't catch overlapping exports | DATABASE-MAPPING §6 |
| ADR-07 | **Four-slot day model** (AM in/out, PM in/out) aligned with CSC Form 48 | The official output needs it | BUSINESS-RULES §4 |
| ADR-08 | Schedules are **blocks** and need **approval** before they count | Split schedules; integrity | BUSINESS-RULES §6 |
| ADR-09 | Attendance rules live in a **versioned rule set** (config, not code edits) | HR policy changes over time | BUSINESS-RULES §5 |
| ADR-10 | Roles: `SYSTEM_ADMIN, HR_ADMIN, HR_STAFF, DEPARTMENT_HEAD, EMPLOYEE`; a user may hold several | Segregation of duties, department scoping | API-DESIGN §4 |
| ADR-11 | **Maker-checker**: requester ≠ approver for exceptions; validator ≠ finalizer (configurable) | Audit integrity | BUSINESS-RULES §8 |
| ADR-12 | One DTR state machine; "downloaded" is an audit event, not a status | Removes v1 duplication | BUSINESS-RULES §7 |
| ADR-13 | DTR items are **snapshotted** at finalization; the PDF's SHA-256 is stored | A signed paper copy can be verified | DATABASE-MAPPING §9 |
| ADR-14 | Phase 1 jobs: synchronous or **pg-boss**; Redis/BullMQ only when needed | One fewer service to run | STACK §6 |
| ADR-15 | Monorepo with **Yarn 4 workspaces** (not npm or pnpm): `apps/api`, `apps/web`, `packages/shared` | Project standard; shared enums; one lockfile and one CI | STACK §2.1 |
| ADR-16 | Timezone `Asia/Manila`; timestamps `TIMESTAMPTZ`; schedule times `TIME` | Device exports are local time | DATABASE-MAPPING §3 |
| ADR-17 | ExcelJS + csv-parse for import; **not** the npm `xlsx` package | Known CVEs in npm `xlsx` 0.18.5 | STACK §5 |
| ADR-18 | DTR PDF = HTML/CSS template → headless Chromium | Pixel-accurate form, easy to maintain | STACK §7 |
| ADR-19 | Direct device sync (ADMS/API) is **Phase 3** behind `AttendanceSource` | Lowers Phase 1 risk | ARCHITECTURE §8 |
| ADR-20 | Wet signature stays; the system tracks submission and receipt | Existing legal requirement | BUSINESS-RULES §7 |
| ADR-21 | DTR periods are **semi-monthly** (1–15, 16–end of month) for **all** employees. Each period is printed on **its own CSC Form 48**; there is no monthly form. | HR answers Q-P1, C-01 (D-HR-01, D-HR-17). Supersedes BUSINESS-RULES Q13. | BUSINESS-RULES §3, §9 |
| ADR-22 | **Advance DTR processing**: HR runs processing with `processing_type = ADVANCE` and chooses `processed_until`, usually 2–3 days before the period end. Every employee with an approved schedule gets **full scheduled minutes** for the dates after it. These days are **printed with time in/out from the schedule** and no remark. | HR answers Q-P2, Q-A1, Q-A2, Q-A4, C-03 (D-HR-02 to D-HR-05) | BUSINESS-RULES §12 |
| ADR-23 | **Advance credits are a persisted ledger** (`advance_credits` + append-only `advance_credit_events`). They are **not** rebuilt by reprocessing. *Amends ADR-04:* processed attendance stays rebuildable, but the ledgers (advance credits, make-up outcomes, offset ledger) are decisions made at a point in time. | A credit is given before the data exists, so it can't be derived from inputs. HR wants full history (C-04, D-HR-19). | BUSINESS-RULES §2, DATABASE-MAPPING §8 |
| ADR-24 | **Automatic reconciliation** runs when an import is committed. It covers every `ADVANCED` credit whose `credit_date` falls **inside the batch's detected date range** (`detected_date_from ≤ credit_date ≤ detected_date_to`) **for a device the employee is mapped to**. Once a date is covered, **no punches = ABSENT → REVERSED**. A later import with punches for that date **re-evaluates** the credit, so a reversal can be restored (BUSINESS-RULES §12.4). | HR answers Q-A5, Q-A6, C-04 (D-HR-07, D-HR-08) | BUSINESS-RULES §12 |
| ADR-25 | **Carry-forward adjustments**: deductions (negative) and restorations (positive) from reconciliation, late approvals and missed make-up classes land in the **next open DTR period**. They are stored as rows in one ledger, `carry_forward_adjustments`, whatever their source: advance credit, make-up outcome, or a late-approved exception/letter on a day with no credit. `dtrs.prior_period_adjustment_minutes` = the SUM of the rows applied to that period. If the source DTR is not finalized yet, the day is simply recalculated in that DTR and no carry-forward row is created. A signed/finalized DTR is **never** changed. | ADR-13 + HR answers Q-A3, Q-A7, C-02, C-11 (D-HR-06, D-HR-09, D-HR-18, D-HR-22) | BUSINESS-RULES §12 |
| ADR-26 | Every processed day records its **attendance basis**: `ACTUAL`, `SCHEDULE_DERIVED`, `ADVANCE` or `MIXED`. Each slot records its source in `slot_sources`. | Explains where printed times came from, especially advance days that print like normal days | BUSINESS-RULES §4, DATABASE-MAPPING §8 |
| ADR-27 | New attendance reasons:<br>• `ASYNCHRONOUS`: HR-entered, whole day, auto-approved.<br>• `OFFSET`, `WELLNESS`, `MAKE_UP_CLASS`: exception types that need approval.<br>• `GOVERNMENT_ANNOUNCEMENT`: a **calendar event**, government-wide (`scope = ALL`), can be partial-day.<br>Approved reasons **override punches** for the blocks they cover. | HR requirements §2.3 + answers Q-R1, Q-R2, Q-R6, C-07, C-08 (D-HR-10, D-HR-11, D-HR-15) | BUSINESS-RULES §8 |
| ADR-28 | **Two-level approval**: the Department Head (or Dean) **endorses**, then HR **approves**. This applies to `OFFSET`, `WELLNESS` and **schedule changes**. `MAKE_UP_CLASS` and earned-offset requests are approved by the **Head/Dean only**. Maker-checker applies at every level. *Extends ADR-08 and ADR-11.* | HR answers Q-R5, C-05, C-09, C-10 (D-HR-14, D-HR-20, D-HR-21) | BUSINESS-RULES §6, §8 |
| ADR-29 | **Offset balance**: earned offset hours are requested, approved by the Head/Dean, and kept in an `offset_ledger` per semester. Unused hours **expire at the end of the semester** they were earned in. Using offset requires enough balance. | HR answers Q-R3, C-05 (D-HR-12) | BUSINESS-RULES §8 |
| ADR-30 | **Wellness**: at most **4 whole days per academic year** | HR answers Q-R4, C-06 (D-HR-13) | BUSINESS-RULES §8 |
| ADR-31 | **Make-up class**:<br>• A **letter is required**.<br>• The original date is **ABSENT** until a letter is approved, then excused.<br>• The make-up date **requires punches**, measured against the make-up times.<br>• The make-up may fall in a later period.<br>• If it isn't attended, the excuse is reversed and carried forward (ADR-25). | HR answers Q-M1 to Q-M3 (D-HR-23 to D-HR-25) | BUSINESS-RULES §8 |
| ADR-32 | All attendance rules apply to **all employees** (faculty and non-teaching). Tardiness is measured from the **AM/PM group start**, not from each schedule entry. *Confirms ADR-07/ADR-08 and answers BUSINESS-RULES Q9.* | HR answers Q-S3, Q-S4 (D-HR-16) | BUSINESS-RULES §4.2 |

---

## 3. Glossary

| Term | Meaning |
|---|---|
| **DTR** | Daily Time Record, **CSC Form No. 48**. In v3, one form is printed per **semi-monthly** period (ADR-21). |
| **DTR period** | The date range one DTR covers: **1–15** or **16–end of month** (ADR-21). It belongs to a semester. |
| **Punch** | One biometric scan event (`biometric_identifier` + timestamp + device) |
| **Raw punch** | A punch exactly as exported by the device. It is never edited. |
| **Slot** | One of the four DTR times: `AM_IN`, `AM_OUT`, `PM_IN`, `PM_OUT` |
| **Schedule block** | An expected working interval on a weekday (e.g., Mon 08:00–12:00) |
| **Processed day** | The calculated result for one employee on one date (slots, tardy, undertime, status) |
| **Exception** | An approved reason that changes a day's calculation: leave, official business, time correction, missing-punch certification, and so on |
| **Rule set** | A versioned group of attendance parameters (grace minutes, rounding, flexi window…) |
| **Tardiness** | Minutes late relative to the scheduled start of a block, after grace |
| **Undertime** | Minutes of scheduled time not rendered because of late arrival *or* early departure (see BUSINESS-RULES §5.4 for the exact CvSU definition, still to be confirmed) |
| **In-Charge** | The supervisor who signs the DTR as "verified as to the prescribed office hours" (maps to `DEPARTMENT_HEAD`) |
| **COS / JO** | Contract of Service / Job Order workers. Different rules may apply. |
| **Advance processing** | Processing a DTR period before its end, up to `processed_until`. The remaining days get advance credit (ADR-22). |
| **Advance credit** | Temporary full-schedule credit for a date after `processed_until`. It is later RECONCILED, ADJUSTED or REVERSED against actual attendance (ADR-23, ADR-24). |
| **Reconciliation** | Comparing an advance credit (or a make-up class) with the actual attendance once an import covers that date |
| **Carry-forward adjustment** | A deduction or restoration applied to the **next open** DTR because the earlier DTR is already finalized. Stored in `carry_forward_adjustments` (ADR-25). |
| **Attendance basis** | Where a processed day's times came from: `ACTUAL`, `SCHEDULE_DERIVED`, `ADVANCE`, `MIXED` (ADR-26) |
| **Endorsement** | The first approval level (Department Head/Dean) before HR approval (ADR-28) |
| **Offset** | Using earned extra hours to cover scheduled time. Earned hours expire at semester end (ADR-29). |
| **Wellness** | Approved whole-day absence, at most 4 days per academic year (ADR-30) |
| **Make-up class** | A class moved from an original date to a make-up date, backed by an approved letter (ADR-31) |
| **Asynchronous** | A whole day of asynchronous classes, entered by HR, credited using schedule times (ADR-27) |
| **Government announcement** | A government-wide announcement (e.g., suspension) recorded as a calendar event. It can be partial-day (ADR-27). |
| **Work suspension** | An officially declared suspension of work (weather, calamity, proclamation) |

---

## 4. Changelog

### v3.0 — 2026-10-05
- Source: HR (client) requirements, analysed in [[CVSU-DTR/HR-Requirements-Analysis|HR-Requirements-Analysis]]. HR answered all questions in two rounds plus follow-ups.
- New ADR-21 to ADR-32: semi-monthly periods, advance processing, the advance-credit ledger, automatic reconciliation, carry-forward adjustments, attendance basis, new attendance reasons, two-level approval, offset balance, wellness limit, make-up class, rules for all employees.
- ADR-04 is amended by ADR-23. ADR-08 and ADR-11 are extended by ADR-28.
- BUSINESS-RULES Q9 and Q13 are answered.
- HR's proposed ERD was **not** adopted as-is. It was merged into the v2 schema (see the analysis, §2 and §4).
- Remaining open items: see the analysis §8.7 (O-3 to O-7) and BUSINESS-RULES §11.

### v2.0 — 2026-09-29
- Added REQUIREMENTS, BUSINESS-RULES, SECURITY-PRIVACY and this README.
- Resolved 17 cross-document conflicts (see Review §2).
- Fixed 12 data-model flaws (see Review §3), including raw immutability, adjustments lost on reprocessing, per-batch processing, missing calendar and the one-block-per-day limit.
- Unified the DTR state machine and removed `DOWNLOADED` / `SIGNED_SUBMITTED` / `dtr_submissions` duplication.
- Stack: Node 24 LTS, Yarn 4 workspaces monorepo, pg-boss for Phase 1, ExcelJS, headless Chromium PDF.
- Condensed the docs by about 70% by removing repeated diagrams.

### v1.0
- Initial set: ARCHITECTURE, MODULES, DESIGN-PATTERNS, DATABASE-MAPPING, API-DESIGN, STACK, UI_DESIGN.
