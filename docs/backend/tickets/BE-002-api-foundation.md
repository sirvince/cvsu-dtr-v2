---
id: BE-002
title: API foundation (config, errors, logging, health, Clock)
type: Task
priority: P0
status: TODO
epic: E1 Foundation & setup data
module: common
week: 1
day: 2026-10-05
estimate_h: 3
depends_on: [BE-001]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-002 — API foundation

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-security`

## 1. Background & problem
Every endpoint must share the same response envelope, error format, validation, logging and time handling. Building these first avoids rework in 25 later tickets.

## 2. Objective
A NestJS app skeleton with all cross-cutting concerns from [[CVSU-DTR/v3/ARCHITECTURE|ARCHITECTURE]] §9 and [[CVSU-DTR/v3/STACK|STACK]] §3.

## 3. Scope
**In**
- [ ] `@nestjs/config` with a Zod schema for every env var in `.env.example`; app refuses to start on invalid config
- [ ] Global prefix `/api/v1`; `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`
- [ ] Request-ID middleware (`X-Request-Id` accepted or generated, echoed)
- [ ] Response envelope interceptor (`{ data }`, `{ data, meta }`)
- [ ] `DomainError` base class with stable `code`; global filter mapping to API-DESIGN §9 (400/401/403/404/409/413/422/429/500), no stack traces in responses
- [ ] `nestjs-pino` JSON logs with request ID + redaction (authorization, cookie, password, token)
- [ ] `helmet`, strict CORS (`WEB_ORIGIN`), `cookie-parser`, `@nestjs/throttler`, JSON body limit 1 MB
- [ ] `/health` (liveness) and `/health/ready` (DB check) via `@nestjs/terminus`
- [ ] `Clock` port + `SystemClock('Asia/Manila')` + `FixedClock` for tests; `LocalDate` / `LocalTime` wrappers (Temporal polyfill or date-fns-tz)
- [ ] `@nestjs/swagger` at `/api/docs` (non-production only)
- [ ] Generic `makeMachine()` state-machine helper (used from BE-024)

**Out**
- DB entities (BE-003), auth guards (BE-004)

## 4. Acceptance criteria
- [ ] Unknown route → `404` in the error envelope with `requestId`
- [ ] DTO with an extra field → `400 VALIDATION_ERROR` with `details[]`
- [ ] Thrown `DomainError('X', 422)` → `{ error: { code: 'X', … } }`, status 422
- [ ] An unexpected error → `500` with a generic message; stack only in logs
- [ ] Missing `DATABASE_URL` → app exits at startup with a clear message
- [ ] Logs never contain the `Authorization` header value

## 5. Tests
Unit: error filter mapping, `LocalTime` parsing/compare, `makeMachine` (valid/invalid/guard). API: envelope + 404 + validation error shape.

## 6. References
[[CVSU-DTR/v3/API-DESIGN]] §1, §9 · [[CVSU-DTR/v3/DESIGN-PATTERNS]] §4, §8 · [[CVSU-DTR/v3/SECURITY-PRIVACY]] §4
