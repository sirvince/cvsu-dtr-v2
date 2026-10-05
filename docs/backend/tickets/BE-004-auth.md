---
id: BE-004
title: "Auth: login, refresh rotation, lockout, change password"
type: Feature
priority: P0
status: TODO
epic: E1 Foundation & setup data
module: auth / users
week: 1
day: 2026-10-06
estimate_h: 5
depends_on: [BE-003]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-004 — Auth: login, refresh rotation, lockout, change password

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skill: `dtr-security`

## 1. Background & problem
Phase 1 has 1–3 HR accounts, but the auth design must already be the final one (token rotation, lockout) — acceptance test **A1** checks lockout.

## 2. Objective
Secure HR login with short-lived JWT access tokens and rotating refresh-token cookies.

## 3. Scope
**In**
- [ ] `POST /auth/login` → `{ accessToken, expiresIn, user }` + `refresh_token` cookie (`HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`)
- [ ] `POST /auth/refresh` (rotate; reuse of an old token revokes the family + audit `AUTH_REFRESH_REUSED`)
- [ ] `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`
- [ ] argon2id (m ≥ 19 MiB, t=2, p=1); password ≥ 12 chars (+ bundled top breached-passwords list)
- [ ] Lockout: 5 failures → 15 min (`AUTH_ACCOUNT_LOCKED`); throttling per IP and per account on login
- [ ] JWT 15 min, claims `sub, roles, ver`; `ver` bumped on password/role change
- [ ] `JwtAuthGuard`, `RolesGuard` + `@Roles()`, `@Actor()` param decorator; `ScopePolicy` stub (HR_ADMIN = all)
- [ ] First admin seeded from env **without a default password** (invite token or one-time CLI `set-password`)

**Out**
- Invite/forgot/reset email flow, other roles' screens (Phase 1B)

## 4. Acceptance criteria
- [ ] Wrong password and unknown email return the same `401 AUTH_INVALID_CREDENTIALS`
- [ ] 5 wrong passwords → 6th attempt (even correct) → `AUTH_ACCOUNT_LOCKED` (**A1**)
- [ ] Refresh returns a new cookie; the old one used again → `401 AUTH_REFRESH_REUSED`, and the new one is also revoked
- [ ] Access token with an old `ver` after change-password → 401
- [ ] Refresh tokens stored only as SHA-256 hashes
- [ ] Login, logout, lockout written to `audit_logs`

## 5. Tests
API (Supertest): all criteria above + cookie flags. Unit: password policy.

## 6. References
[[CVSU-DTR/v3/SECURITY-PRIVACY]] §2 · [[CVSU-DTR/v3/API-DESIGN]] §2–§3
