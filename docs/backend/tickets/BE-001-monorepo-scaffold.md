---
id: BE-001
title: Monorepo scaffold + CI
type: Task
priority: P0
status: TODO
epic: E1 Foundation & setup data
module: repo
week: 1
day: 2026-10-05
estimate_h: 3
depends_on: []
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-001 — Monorepo scaffold + CI

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skill: `dtr-backend`

## 1. Background & problem
There is no repository yet. Every other ticket needs one shared repo, toolchain and CI so that `lint → typecheck → test → build` runs from day 1.

## 2. Objective
Create the `cvsu-dtr` Yarn 4 monorepo exactly as in [[CVSU-DTR/v3/STACK|STACK]] §2, with a green CI pipeline.

## 3. Scope
**In**
- [ ] Root: `package.json` (workspaces `apps/*`, `packages/*`, `packageManager: yarn@4.x`, `engines.node >=24 <25`), `.yarnrc.yml` (`nodeLinker: node-modules`), `.nvmrc` (24), `.gitignore`, `.editorconfig`, `.env.example`
- [ ] `apps/api` (NestJS, TS strict + `noUncheckedIndexedAccess`), `apps/web` (empty Vite placeholder OK — FE owns it), `packages/shared` (roles, statuses, error codes as `as const` objects)
- [ ] ESLint + Prettier, Husky + lint-staged, commitlint (Conventional Commits)
- [ ] `infra/docker-compose.yml` with `postgres:17` only (for local dev)
- [ ] GitHub Actions: `corepack enable` → `yarn install --immutable` → lint → typecheck → test → build; fail if `package-lock.json` or `pnpm-lock.yaml` exists
- [ ] Copy `CVSU-DTR/v3/.claude/` (skills) into the repo root; copy the v3 docs into `docs/`
- [ ] Verify **`argon2` installs** on the dev machine (the older prototype failed to build native modules on this PC). If it fails: develop the API inside Docker/WSL, or install VS C++ build tools

**Out**
- Production Dockerfiles (BE-027), web app setup (FE)

## 4. Acceptance criteria
- [ ] `git clone → corepack enable → yarn install → yarn dev` works in < 10 minutes on a clean machine (README steps)
- [ ] `yarn lint && yarn typecheck && yarn test && yarn build` pass locally and in CI
- [ ] `packages/shared` is importable from `apps/api` via `"@cvsu-dtr/shared": "workspace:*"`
- [ ] `yarn workspace @cvsu-dtr/api add argon2` succeeds (or the workaround is documented)

## 5. References
[[CVSU-DTR/v3/STACK]] §2, §9 · [[CVSU-DTR/v3/DEVELOPMENT-PHASES]] §7 (Git flow)
