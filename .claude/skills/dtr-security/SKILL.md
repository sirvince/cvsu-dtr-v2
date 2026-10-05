---
name: dtr-security
description: Apply and review security and privacy controls for the CVSU DTR system — authentication (argon2id, JWT, rotating refresh tokens, lockout), authorization (roles, department scopes, 404-on-out-of-scope, maker-checker), file upload/export safety, audit logging of sensitive reads, logging redaction, HTTP hardening, and Data Privacy Act (RA 10173) obligations. Use when writing or reviewing auth code, guards, scope checks, upload/download endpoints, exports, audit logging, Nginx/Helmet/CORS config, secrets, or when asked for a security review of this project.
---

# CVSU DTR — Security & Privacy

The system holds **personal information** of government employees (attendance, DTRs). Raw punches are legal evidence; finalized DTRs are signed government forms. Owner doc: `SECURITY-PRIVACY.md` (plus `API-DESIGN.md §2–§4, §8–§9`). Repo `docs/` or vault `CVSU-DTR/v3/`.

## Threat → control map

| Asset | Threat | Control you must keep |
|---|---|---|
| Attendance / DTR data | Unauthorized viewing, bulk export | RBAC + department scopes, 404 on out-of-scope, audited reads, rate-limited exports |
| Raw punches | Silent edits to hide tardiness | DB grants + append-only trigger; corrections only via exceptions |
| Finalized DTRs | Altered printouts | Frozen `dtr_items`, SHA-256 in `dtr_documents`, verification code on the PDF |
| Schedules | Employee rewrites schedule to erase lateness | Approval workflow; locked for dates covered by FINALIZED+ DTRs |
| Accounts | Credential stuffing, token theft | argon2id, throttling, lockout, httpOnly refresh cookie, rotation + reuse detection |
| Import files | Zip bombs, parser bugs, formula payloads | Size/row/sheet limits, magic bytes, streaming parser, no macros |
| Backups | Theft of dumps | Encrypted, off-server, access-restricted |

## Authentication

| Item | Requirement |
|---|---|
| Password hash | **argon2id**, memory ≥ 19 MiB, t = 2, p = 1 (or stronger). Never bcrypt/sha for passwords |
| Password policy | ≥ 12 chars; reject breached passwords (k-anonymity API or bundled top-100k list offline) |
| Access token | JWT, **15 min**, HS256 with a strong secret (or EdDSA); claims `sub`, `roles`, `ver`. Sent as `Authorization: Bearer`. Web keeps it **in memory only** (no localStorage) |
| Refresh token | Opaque random 256-bit; store **SHA-256 hash** only; 7-day TTL; **rotate on every use** |
| Reuse detection | Presenting an already-rotated token revokes the **whole `family_id`** and logs `AUTH_REFRESH_REUSED` (alert on repeats) |
| Cookie | `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` |
| Lockout | 5 failures → 15 min lock (progressive); throttle per IP **and** per account on `/auth/login`, `/auth/password/*` |
| Token invalidation | Password or role change bumps `ver`; access tokens with an old `ver` are rejected |
| Provisioning | Invite link (single-use, 72 h, hashed in `password_reset_tokens`). **No shared default passwords**, including the seeded admin |
| Forgot password | Always `204` — never reveal whether the account exists |
| Login errors | One generic `AUTH_INVALID_CREDENTIALS` for unknown email and wrong password; compare in constant time |

Refresh rotation sketch:
```ts
async refresh(rawToken: string, ctx: ReqCtx) {
  const hash = sha256(rawToken);
  return this.ds.transaction(async (tx) => {
    const t = await tx.getRepository(RefreshToken).findOne({ where: { tokenHash: hash }, lock: { mode: 'pessimistic_write' } });
    if (!t || t.expiresAt < this.clock.now()) throw new TokenExpiredError();
    if (t.revokedAt || t.replacedBy) {                       // reuse of a rotated token
      await this.revokeFamily(tx, t.familyId);
      await this.audit.record(tx, { action: 'AUTH_REFRESH_REUSED', entityType: 'user', entityId: t.userId, ...ctx });
      throw new RefreshReusedError();
    }
    const next = await this.issue(tx, t.userId, t.familyId, ctx);   // new random token, same family
    await this.markReplaced(tx, t.id, next.id);
    return next;
  });
}
```

## Authorization

Request path: `JwtAuthGuard → RolesGuard(@Roles) → use case: ScopePolicy.assert(actor, resource)`.

| Actor | Scope |
|---|---|
| EMPLOYEE | Own employee record only — resolved **from the token**, never from a path param or body |
| DEPARTMENT_HEAD | Employees in `user_department_scopes` |
| HR_STAFF | Employees in `user_department_scopes` (or all, if configured as global HR staff) |
| HR_ADMIN | All employees |
| SYSTEM_ADMIN | Users/roles/devices + audit log; **no attendance/DTR data access**, cannot change attendance values |

Rules:
- Users can hold several roles; permissions are the **union**. Capability matrix: `API-DESIGN.md §4`.
- **Role missing → 403. Resource out of scope → 404** (don't leak existence). Use the same 404 for "doesn't exist".
- Scope checks belong in the **use case**, not only the controller — list endpoints must filter by scope in the query (`WHERE e.department_id = ANY($scopes)`), not post-filter in memory.
- `/me/*` endpoints derive `employeeId` from `actor`, and must ignore any id in the request.
- Frontend route guards are UX only; never rely on them.
- Segregation of duties: exception approver ≠ requester (DB CHECK + use-case check → `MAKER_CHECKER_VIOLATION` 422); finalizer ≠ validator when `require_two_person_finalize` (default on).
- `GET /jobs/:id` is visible only to the requester and HR_ADMIN.

```ts
@Injectable()
export class ScopePolicy {
  async assertCanAccessEmployee(actor: ActorContext, employeeId: string): Promise<void> {
    if (actor.roles.includes('HR_ADMIN')) return;
    if (actor.employeeId === employeeId) return;                       // own record
    if (actor.roles.some((r) => r === 'HR_STAFF' || r === 'DEPARTMENT_HEAD')) {
      const deptId = await this.employees.departmentOf(employeeId);
      if (deptId && actor.departmentScopes.includes(deptId)) return;
    }
    throw new NotFoundInScopeError('EMPLOYEE_NOT_FOUND');              // → 404, not 403
  }
}
```

## Files

**Upload** (`/attendance-imports`, `/employees/import`):
- Max 20 MB in the app (25 MB at Nginx); body limit 1 MB for normal JSON routes.
- Extension whitelist (`.xlsx`, `.csv`) **and** magic bytes (`PK\x03\x04` for xlsx). Reject `.xlsm` and macros; `.xls` only via a sandboxed conversion step (undecided — needs sample files).
- Zip-bomb guard: cap total **uncompressed** size and entry count before parsing; max 200k rows; one sheet (or a configured sheet name).
- Streaming parse (ExcelJS streaming reader, `csv-parse`); never the npm `xlsx` package.
- Stored under a **random key** outside the web root; never use the user-supplied filename or path. Keep `original_name` only as metadata, sanitized.
- Rate-limit uploads.

**Download** (`/files/:id`, `/dtrs/:id/pdf`, ZIP/merged):
- Always through an authorized endpoint (role + scope); never a public storage URL.
- Headers: `Content-Disposition: attachment; filename="<safe>"`, `Cache-Control: no-store`, correct `Content-Type`, `X-Content-Type-Options: nosniff`.
- Audit `DTR_DOWNLOADED`.

**Export** (CSV/XLSX reports): escape any cell starting with `=`, `+`, `-`, `@`, tab or CR:
```ts
export const escapeCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};
```

## Audit & privacy (RA 10173 — Data Privacy Act of 2012)

- `AuditService.record()` runs **in the same transaction** as the state change. `audit_logs` is append-only.
- Record writes **and sensitive reads** when the viewer is not the data subject: `DTR_VIEWED`, `ATTENDANCE_VIEWED`, `RAW_PUNCHES_VIEWED`, `REPORT_EXPORTED`, `DTR_DOWNLOADED`.
- Proportionality: store **no biometric templates** — only enrolment numbers and timestamps. Collect only fields needed for DTR processing.
- Privacy notice at first login; record acceptance.
- Employees can view/download their own records; corrections go through the exceptions workflow, never by editing raw data.
- Staging/local data must be **anonymized** or synthetic. Test fixtures from real MB20 exports must be anonymized before commit.
- Retention (⚠ confirm with DPO/records officer): import staging 7 days, original uploads 1 year, expired tokens +30 days, DTRs/raw punches per records schedule; purge runs as a privileged, logged job.
- PIA with the CvSU DPO before go-live. This is not legal advice — flag privacy questions for the DPO.

## Logging and errors

- `nestjs-pino` with redaction paths: `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.newPassword`, `*.currentPassword`, `*.token`, `*.refreshToken`, `*.accessToken`.
- Log IDs, not names, emails, or file contents.
- Error responses: no stack traces, no SQL, no internal paths; include `requestId`.

## HTTP hardening

- Helmet; CSP `default-src 'self'`; `frame-ancestors 'none'`; HSTS at Nginx; TLS only.
- CORS restricted to `WEB_ORIGIN`; credentials only for `/auth/*`.
- `@nestjs/throttler` on login, password reset, uploads, report exports.
- DTO whitelisting (`forbidNonWhitelisted`); sort fields whitelisted; parameterized SQL only.
- `/health/ready` and `/api/docs` are internal / non-production only. PostgreSQL never exposed publicly.

## Secrets and supply chain

- Secrets only in env / secret store; `.env` never committed (`.env.example` has `***` placeholders). App refuses to start on missing/invalid config.
- `yarn npm audit --all --recursive` in CI; Dependabot/Renovate; container image scanning.
- Only Yarn 4 — CI fails if `package-lock.json` or `pnpm-lock.yaml` appears.

## Backups

Nightly `pg_dump -Fc`, encrypted (age/GPG), copied off-server; keep 7 daily / 4 weekly / 12 monthly; files backed up on the same schedule. RPO ≤ 24 h, RTO ≤ 4 h. **Quarterly restore test** — an untested backup doesn't count.

## Security review checklist (use for PRs touching auth, data access, files)

- [ ] Every new endpoint has `@Roles` **and** a scope check in its use case; list queries filter by scope in SQL
- [ ] Out-of-scope returns 404; missing capability returns 403; tests prove both
- [ ] Employee identity comes from the token on `/me/*`
- [ ] No raw SQL concatenation; sort/filter fields whitelisted
- [ ] No update/delete path for raw punches or audit logs; corrections go through exceptions
- [ ] Maker-checker and finalizer ≠ validator enforced (use case + DB)
- [ ] Uploads: size, extension, magic bytes, zip-bomb, row limits; random storage key
- [ ] Downloads: authorized endpoint, `no-store`, `attachment`, audited
- [ ] Exports escape formula cells
- [ ] Sensitive reads by non-subjects are audited
- [ ] No secrets, tokens, passwords or personal data in logs, errors, or the web bundle (`VITE_API_BASE_URL` is the only web env)
- [ ] Rate limits on the new endpoint if it's auth, upload, or export
- [ ] New dependency checked (maintained, no known CVEs; not npm `xlsx`)
