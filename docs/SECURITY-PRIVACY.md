---
title: CVSU DTR — Security, Privacy and Operations
version: 2.0
status: draft
updated: 2026-09-29
---

# CVSU DTR — Security, Privacy and Operations

Related: [[CVSU-DTR/v3/API-DESIGN|API-DESIGN]] · [[CVSU-DTR/v3/DATABASE-MAPPING|DATABASE-MAPPING]] · [[CVSU-DTR/v3/STACK|STACK]]

> [!note] Not legal advice
> The privacy section lists what to prepare. Confirm the details with the **CvSU Data Protection Officer (DPO)** and the university records officer.

---

## 1. Assets and threats

| Asset | Main threats | Key controls |
|---|---|---|
| Attendance and DTR data (personal information) | Unauthorized viewing, bulk export, tampering | RBAC + scopes, 404 on out-of-scope, audit of reads, append-only raw data |
| Raw punches (evidence) | Silent edits to hide tardiness | DB grants + trigger (append-only), exceptions workflow |
| Finalized DTRs | Altered printouts | Snapshot items, SHA-256 stored, verification code on PDF |
| Schedules | Employee edits schedule to erase lateness | Approval workflow, lock after finalization |
| Accounts | Credential stuffing, weak passwords, token theft | argon2id, rate limits, lockout, httpOnly refresh cookie, rotation + reuse detection |
| Import files | Malicious XLSX (zip bomb, XXE-like parser bugs, formula payloads) | Size/row limits, magic-byte check, streaming parser, no macros, formula escaping on export |
| Backups | Theft of dumps | Encrypted, off-server, access-restricted |

## 2. Authentication
- Passwords: **argon2id** (memory ≥ 19 MiB, t=2, p=1 or stronger); minimum 12 characters; check against a breached-password list (e.g., k-anonymity range API, or a bundled top-100k list if offline).
- Access token: JWT, 15 min, HS256 with a strong secret (or EdDSA); claims `sub`, `roles`, `ver`.
- Refresh token: opaque random 256-bit, stored **hashed** (`refresh_tokens`), 7-day TTL, rotated on every use. Reusing an old token revokes the whole family and logs `AUTH_REFRESH_REUSED`.
- Cookie: `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`.
- Lockout: 5 failed attempts → 15 min lock (progressive). Per-IP and per-account throttling on `/auth/login` and `/auth/password/*`.
- Account provisioning: HR bulk import → invitation link (single-use, 72 h) → user sets password. No shared default passwords.
- Changing a password or roles bumps `ver`, so older access tokens are rejected at the next check.
- Future: SSO (OIDC, e.g., Google Workspace) if the university provides it.

## 3. Authorization
- Capabilities per role: [[CVSU-DTR/v3/API-DESIGN#4. Roles and permissions]].
- Scope checks happen in **use cases**, not only in controllers. Employee identity always comes from the token.
- Out-of-scope → `404`. Role lacks capability → `403`.
- Segregation of duties: exception approver ≠ requester (DB CHECK); finalizer ≠ validator (configurable, on by default); SYSTEM_ADMIN cannot change attendance values.

## 4. Application security checklist
- [ ] Helmet headers; CSP `default-src 'self'`; `frame-ancestors 'none'`; HSTS at Nginx
- [ ] CORS restricted to `WEB_ORIGIN`, with credentials allowed only for `/auth/*`
- [ ] DTO whitelisting; no raw SQL string concatenation; sort fields whitelisted
- [ ] File upload guards (API-DESIGN §8); stored with random keys outside the web root
- [ ] Downloads through authorized endpoints with `Cache-Control: no-store`
- [ ] CSV/Excel export formula escaping
- [ ] Error responses without stack traces; request ID for support
- [ ] Logs redact `password`, `token`, `authorization`, `cookie`; no full file contents
- [ ] Dependency scanning (`yarn npm audit --all --recursive`, Dependabot/Renovate); container image scanning
- [ ] Secrets only in env/secret store; `.env` never committed
- [ ] Rate limits: login, password reset, uploads, report exports

## 5. Data Privacy Act of 2012 (RA 10173)

| Obligation (summary) | What the system / project does |
|---|---|
| Transparency | Privacy notice shown at first login (what is collected, why, retention, contact DPO); acceptance recorded |
| Legitimate purpose | Data used only for attendance/DTR processing and HR reporting |
| Proportionality | Collect only needed fields. **No biometric templates** are stored; only enrolment numbers and timestamps. |
| Access control | RBAC + department scopes; least privilege |
| Accountability | Audit log of writes **and of sensitive reads** (`DTR_VIEWED`, `ATTENDANCE_VIEWED`, `RAW_PUNCHES_VIEWED`, `REPORT_EXPORTED`) when the viewer is not the data subject |
| Data subject rights | Employees can view and download their own records; correction requests go through the exceptions workflow |
| Security measures | This document (§1–§4, §7) |
| Breach management | Incident procedure with the DPO; the law sets tight notification deadlines for qualifying breaches, so the DPO must be reachable |
| Privacy impact assessment | Do a PIA with the DPO before go-live |

## 6. Retention ⚠ (confirm with the records officer / DPO)

| Data | Proposed retention | Then |
|---|---|---|
| Finalized DTRs (items + PDF) | Per the university's records disposition schedule (government records) | Archive / dispose per schedule |
| Raw punches | Same as DTRs for the covered period | Purge by privileged job (logged) |
| Processed attendance | Same as raw (rebuildable) | Purge |
| Import staging rows | 7 days after commit/discard | Auto-purge |
| Import files (original uploads) | 1 year (raw punches remain the evidence) | Delete file, keep metadata |
| Audit logs | ≥ the longest retention above | Archive |
| Refresh / reset tokens | Expired + 30 days | Auto-purge |
| Inactive user accounts | Deactivate on separation; keep the linked employee history | — |

## 7. Backups and recovery
- Nightly `pg_dump -Fc`, encrypted (age/GPG), copied **off-server** (a second university server or object storage). Keep 7 daily, 4 weekly and 12 monthly copies.
- File storage (PDFs, uploads) is backed up on the same schedule.
- Targets: **RPO ≤ 24 h, RTO ≤ 4 h** (Phase 1). Add WAL archiving/PITR if HR needs a better RPO.
- **Quarterly restore test** into staging, recorded with date and outcome. An untested backup does not count.

## 8. Monitoring and operations
- `/health` (liveness) and `/health/ready` (DB, storage, job queue), internal only.
- Alerts on: failed jobs, 5xx rate, disk > 80%, backup job failure, repeated `AUTH_REFRESH_REUSED`.
- Admin view listing job history (pg-boss), recent imports and processing runs.
- Runbooks: *import failed*, *PDF rendering failed*, *restore from backup*, *reopen a finalized DTR*, *rotate secrets*.

## 9. Go-live checklist
- [ ] PIA done and privacy notice approved by the DPO
- [ ] HR signed off on rule set v1 and the test table (BUSINESS-RULES §10)
- [ ] Real MB20 exports parsed correctly for 3 months of data
- [ ] PDF matches the official template (checked by HR, printed on the actual printer)
- [ ] Pilot with one department for one full DTR period, with results compared to the manual process
- [ ] Backups running + one successful restore test
- [ ] Admin/HR accounts with correct roles and scopes; no default passwords
- [ ] Runbooks written; support contact defined
