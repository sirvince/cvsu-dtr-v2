---
id: BE-027
title: Deploy (Compose, Nginx, TLS) + backup + restore test
type: Task
priority: P0
status: TODO
epic: E4 PDF, finalize, deploy
module: infra
week: 4
day: 2026-10-29
estimate_h: 5
depends_on: [BE-025, BE-026]
blocked_by: [B6 server, domain, TLS]
phase: 1
tags: [cvsu-dtr, backend, ticket, never-cut]
---

# BE-027 — Deploy + backup + restore test

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skill: `dtr-security`

> [!danger] Blocked by B6
> Request the server **this week**. Fallback: demo on a laptop with Docker Compose and deploy the following week. **Backups are never cut.**
> Tip: write the Dockerfiles and compose file early (week 2–3) and test them locally so deploy day is only server work.

## 1. Objective
Run Phase 1 on the real server with TLS, nightly encrypted backups, and one successful restore test (acceptance **A12**).

## 2. Scope
**In**
- [ ] Multi-stage Dockerfile for `api` (Node 24, **Chromium + bundled fonts**, non-root user); web built to static files
- [ ] `infra/docker-compose.prod.yml`: `nginx`, `api`, `postgres:17` (volume, not exposed), `backup`
- [ ] Nginx: TLS (university cert or Let's Encrypt), HSTS, CSP/security headers, `client_max_body_size 25m`, `/api/v1` proxy (`proxy_read_timeout` per D5), SPA fallback
- [ ] `.env` on the server only (secrets generated there); `WEB_ORIGIN`, `JWT_ACCESS_SECRET`, DB URLs for `app_user` and `migrator`
- [ ] Deploy steps: backup → `migration:run` as `migrator` → start → `/health/ready` → seed (first run) → smoke test
- [ ] Backup container: nightly `pg_dump -Fc` + file storage, encrypted (age/GPG), copied **off-server**; keep 7 daily / 4 weekly / 12 monthly
- [ ] **Restore test**: restore last night's dump into a scratch DB, run a count check; record date + result
- [ ] Rollback steps written down

**Out**
- Monitoring/alerts, staging environment, CI auto-deploy (1B)

## 3. Acceptance criteria
- [ ] HR opens `https://<domain>` and logs in
- [ ] PostgreSQL port not reachable from outside
- [ ] Server restart → data intact, today's backup exists (**A12**)
- [ ] Restore test passed and recorded
- [ ] Production has no `/api/docs` and no demo seed data

## 4. References
[[CVSU-DTR/v3/STACK]] §8–§10 · [[CVSU-DTR/v3/ARCHITECTURE]] §10 · [[CVSU-DTR/v3/SECURITY-PRIVACY]] §7, §9
