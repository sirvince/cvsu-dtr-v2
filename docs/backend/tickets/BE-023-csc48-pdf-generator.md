---
id: BE-023
title: CSC Form 48 template + Puppeteer PDF + SHA-256
type: Feature
priority: P0
status: TODO
epic: E4 PDF, finalize, deploy
module: dtr (documents)
week: 4
day: 2026-10-26
estimate_h: 6
depends_on: [BE-020]
blocked_by: [P2 Form 48 template]
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-023 — CSC Form 48 template + Puppeteer PDF + SHA-256

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-security`

> [!danger] Blocked by P2
> Needs CvSU's official DTR template and one filled sample. If late, start from the standard CSC Form 48 layout and adjust after HR review (BE-026). **Start the HTML template early** (e.g., week 3 slack) — this is the riskiest week-4 item.

## 1. Background & problem
The PDF is the official output that employees print and wet-sign. It must match the paper form, and a printed copy must be verifiable later (ADR-13, ADR-18).

## 2. Objective
`DtrPdfGenerator` port + `ChromiumHtmlPdfGenerator` that renders a DTR's items into CSC Form 48 and stores it with its hash.

## 3. Scope
**In**
- [ ] `templates/csc48/csc48.html` + CSS: header (name, month, office hours), 31 day rows, AM arrival/departure, PM arrival/departure, undertime hours/minutes, remarks, certification text, employee signature line, "In-Charge" verification line; two copies per page if CvSU's template does that
- [ ] Data binding with a safe template engine (escape all values — no raw HTML from data)
- [ ] Times printed in the format the paper form uses (confirm with P2 sample)
- [ ] Puppeteer `page.pdf({ format: 'A4' | 'Letter', printBackground: true })`; **fonts bundled locally**, request interception blocks all network
- [ ] Reuse one browser instance; close pages; timeout per render
- [ ] Save via `FileStorage` (`purpose = DTR_PDF`); insert `dtr_documents` (`dtr_version`, `sha256`, `template_version = 'CSC48-2026.1'`, `CURRENT`)
- [ ] Footer: DTR version + verification code (first 10 hex chars of SHA-256)
- [ ] Dockerfile note: Chromium + fonts must be in the `api` image (Phase 1 has no worker)

**Out**
- `/dtrs/verify/:code` lookup (1B, "Could")

## 4. Acceptance criteria
- [ ] PDF for a 31-day month fits one page per copy and opens in any viewer
- [ ] Rendering works with the network disabled
- [ ] Stored SHA-256 equals the hash of the downloaded file
- [ ] A name containing `<script>` renders as text
- [ ] Render time per DTR measured (target < 2 s)

## 5. Tests
Unit: template data mapping (items → rows, undertime h/m). Int: render a fixture DTR, check page count + hash stored.

## 6. References
[[CVSU-DTR/v3/STACK]] §7 · [[CVSU-DTR/v3/DATABASE-MAPPING]] §9 · [[CVSU-DTR/v3/UI_DESIGN]] §9
