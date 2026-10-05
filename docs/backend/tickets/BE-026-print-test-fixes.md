---
id: BE-026
title: Print test on HR printer + layout fixes
type: Task
priority: P0
status: TODO
epic: E4 PDF, finalize, deploy
module: dtr (documents)
week: 4
day: 2026-10-28
estimate_h: 2
depends_on: [BE-023]
blocked_by: [HR printer access]
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-026 — Print test on HR printer + layout fixes

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]]

## 1. Background & problem
Risk R4: the PDF may look right on screen but print wrong (margins, scaling, paper size, fonts). The paper copy is what gets signed.

## 2. Objective
Print real DTRs on **HR's actual printer** and fix the template until HR accepts it.

## 3. Scope
- [ ] Print 3 DTRs: a 31-day month, a month with holidays/remarks, a long employee name
- [ ] Check: paper size (A4 vs Letter vs Legal), margins, "fit to page" off, 31 rows visible, signature lines, two copies per page if required, font readability
- [ ] Compare side-by-side with the official filled sample (P2); HR signs off
- [ ] Bump `template_version` when the layout changes; regenerate already-finalized PDFs only through reopen

## 4. Acceptance criteria
- [ ] HR confirms in writing that the printout matches the official form
- [ ] Printer settings that HR must use are written in the user guide

## 5. References
[[CVSU-DTR/v3/DEVELOPMENT-PHASES]] §10 R4 · [[CVSU-DTR/v3/SECURITY-PRIVACY]] §9
