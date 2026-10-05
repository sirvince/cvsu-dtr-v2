---
id: BE-025
title: PDF download + bulk ZIP / merged
type: Feature
priority: P1
status: TODO
epic: E4 PDF, finalize, deploy
module: dtr / files
week: 4
day: 2026-10-27
estimate_h: 3
depends_on: [BE-023, BE-024]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-025 — PDF download + bulk ZIP / merged

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-security`

> [!warning] Merged PDF is cut list #2 — keep ZIP.

## 1. Objective
HR downloads one DTR or a whole department (acceptance **A11**). Every download is audited.

## 2. Scope
**In**
- [ ] `GET /dtrs/:id/pdf` (`?version=n`): FINALIZED only (else `422 DTR_DOCUMENT_NOT_READY`); render lazily if no CURRENT document (D5); headers `attachment`, `no-store`, `application/pdf`; filename `DTR_<employeeNo>_<YYYY-MM>.pdf`
- [ ] `POST /dtrs/download { dtrIds[] | dtrPeriodId + departmentId, format: ZIP | MERGED }`: **streams** a ZIP of stored PDFs (`archiver`) or a merged PDF (`pdf-lib`); only FINALIZED DTRs included; response lists skipped ones (header or manifest file)
- [ ] Cap: one department / ≤ 300 DTRs per request
- [ ] Audit `DTR_DOWNLOADED` per DTR (bulk = one row per DTR, or one row with ids in `metadata`)

**Out**
- Employee self-download `/me/dtrs/:id/pdf` (1B)

## 3. Acceptance criteria
- [ ] Single PDF and department ZIP open correctly (**A11**)
- [ ] DRAFT DTR download → `422`
- [ ] ZIP of 300 PDFs streams without loading all files into memory
- [ ] Each download appears in `audit_logs`

## 4. References
[[CVSU-DTR/v3/API-DESIGN]] §5.9, §8 · [[CVSU-DTR/v3/PHASE1-MVP-1-MONTH]] §3 step 16
