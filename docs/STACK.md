---
title: CVSU DTR — Technology Stack
version: 2.0
status: draft
updated: 2026-09-29
---

# CVSU DTR — Technology Stack

Related: [[CVSU-DTR/v3/ARCHITECTURE|ARCHITECTURE]] · [[CVSU-DTR/v3/DESIGN-PATTERNS|DESIGN-PATTERNS]] · [[CVSU-DTR/v3/SECURITY-PRIVACY|SECURITY-PRIVACY]]

> All decisions here are **final for Phase 1** unless changed through the README ADR log. Use the current stable major of each library at project start and pin exact versions in the lockfile.

---

## 1. Summary

| Layer | Choice | Notes |
|---|---|---|
| Runtime | **Node.js 24 LTS** | Pin with `.nvmrc` / `engines`. (v1's Node 22 is in maintenance LTS until Apr 2027.) |
| Language | TypeScript (strict) | `strict: true`, `noUncheckedIndexedAccess: true` |
| Package manager | **Yarn 4** (Berry) workspaces | One `yarn.lock`; never mix in npm or pnpm (§2.1) |
| Backend | NestJS | REST, DI, guards, modules |
| ORM | TypeORM | Migrations only (`synchronize: false`) |
| Database | PostgreSQL 17+ | `citext`, `btree_gist` extensions |
| Background jobs | Inline (dev) → **pg-boss** (Phase 1 prod) | Redis + BullMQ only if measured need (§6) |
| Auth | `@nestjs/passport` + `passport-jwt`, **argon2id** | Refresh tokens in DB, httpOnly cookie |
| Validation | `class-validator` + `class-transformer` (API), **Zod** (web forms) | API types for the web are generated from OpenAPI |
| API docs | `@nestjs/swagger` (OpenAPI 3.1) | `/api/docs` non-prod |
| Spreadsheet import | **ExcelJS** (streaming) + **csv-parse** | Not the npm `xlsx` package (§5) |
| PDF (DTR) | HTML/CSS template + **Puppeteer** (headless Chromium) | In the worker container (§7) |
| Date/time | `@js-temporal/polyfill` (or `date-fns-tz`) behind `LocalDate/LocalTime` wrappers | Asia/Manila business logic |
| Logging | `nestjs-pino` | JSON; redact secrets and PII |
| Frontend | React + Vite + TypeScript | SPA served by Nginx |
| Routing | React Router | Role-based route guards (UX only) |
| Server state | TanStack Query | No Redux |
| Forms | React Hook Form + Zod | |
| Styling | Tailwind CSS + a headless component kit (e.g., shadcn/ui on Radix) | One UI system; `lucide-react` icons |
| Tables | TanStack Table | Server-side pagination/sort/filter |
| Testing | Jest + Supertest + Testcontainers (API); Vitest + Testing Library (web); Playwright (E2E) | |
| Quality | ESLint, Prettier, `tsc --noEmit`, Husky + lint-staged, commitlint (Conventional Commits) | |
| Containers | Docker + Docker Compose | Nginx, api, worker, postgres, backup |
| CI | GitHub Actions (or GitLab CI) | lint → typecheck → test → build → image → deploy |

---

## 2. Repository layout (monorepo)

```
cvsu-dtr/
├── apps/
│   ├── api/                  # NestJS (API + worker mode)
│   │   ├── src/{main.ts, worker.ts, app.module.ts, common/, config/, modules/}
│   │   ├── test/             # e2e (Supertest), fixtures (anonymized MB20 exports)
│   │   └── templates/csc48/  # DTR HTML/CSS template + assets
│   └── web/                  # React + Vite
│       └── src/{app/, components/ui/, features/<feature>/{pages,components,hooks,api}, lib/}
├── packages/
│   ├── shared/               # enums (roles, statuses, error codes), constants, pure utils
│   └── api-client/           # generated from OpenAPI (openapi-typescript + openapi-fetch)
├── infra/
│   ├── docker-compose.yml    docker-compose.prod.yml
│   ├── nginx/                # conf, security headers
│   └── backup/               # pg_dump cron + encryption + offsite push
├── docs/                     # ← these v3 documents
├── .nvmrc  .yarnrc.yml  yarn.lock  package.json (workspaces)  .env.example
└── README.md
```

### 2.1 Yarn setup

Root `package.json`:
```json
{
  "name": "cvsu-dtr",
  "private": true,
  "packageManager": "yarn@4.x.x",
  "workspaces": ["apps/*", "packages/*"],
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "dev":       "yarn workspaces foreach -pi -A run dev",
    "build":     "yarn workspaces foreach -At run build",
    "lint":      "yarn workspaces foreach -A run lint",
    "typecheck": "yarn workspaces foreach -A run typecheck",
    "test":      "yarn workspaces foreach -A run test"
  }
}
```
The `x.x` is a placeholder. Pin the exact 4.x version at project start (`yarn set version stable` writes it here).

`.yarnrc.yml`:
```yaml
nodeLinker: node-modules      # plain node_modules; avoids Plug'n'Play problems with NestJS, TypeORM CLI and Puppeteer
enableTelemetry: false
```

Rules:
- Enable Yarn with `corepack enable`. The `packageManager` field then pins the Yarn version for every developer and for CI.
- Commit `yarn.lock` and `.yarnrc.yml`. Add `.yarn/cache` and `.yarn/install-state.gz` to `.gitignore` unless you choose zero-installs.
- Delete any `package-lock.json` or `pnpm-lock.yaml` if one appears. CI fails if either file exists.
- Workspace dependencies use `"@cvsu-dtr/shared": "workspace:*"`.

| Task | Command |
|---|---|
| Install | `yarn install` (CI: `yarn install --immutable`) |
| Add a dependency to an app | `yarn workspace @cvsu-dtr/api add exceljs` |
| Add a dev tool at the root | `yarn add -D prettier` |
| Run a script in one app | `yarn workspace @cvsu-dtr/web dev` |
| Run migrations | `yarn workspace @cvsu-dtr/api migration:run` |
| Audit dependencies | `yarn npm audit --all --recursive` |
| Upgrade interactively | `yarn up -i` (needs the `interactive-tools` plugin) |

**Why a monorepo:** the roles, statuses and error codes live in one place and are used by both apps; the API client is generated, so frontend/backend drift fails CI; there is one PR per feature.

---

## 3. Backend details

- **NestJS config:** `@nestjs/config` with a Zod/Joi schema. The app refuses to start on missing or invalid env.
- **Global pipes:** `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
- **Global filter:** maps domain errors to the API-DESIGN §9 format.
- **Interceptors:** request ID, logging, response envelope.
- **Security middleware:** `helmet`, `@nestjs/throttler`, strict CORS (known web origin only), `cookie-parser`, body limit 1 MB (JSON) and 20 MB (upload routes only).
- **Worker mode:** `node dist/worker.js` starts the same modules without the HTTP server and subscribes to pg-boss queues.
- **DB access:** a dedicated role `app_user` without UPDATE/DELETE on append-only tables; migrations run as `migrator`.

## 4. Frontend details

- Feature-based folders. `components/ui` contains only generic primitives.
- The access token is held **in memory**. On a 401 the client calls `/auth/refresh` once, then retries.
- `packages/api-client` provides typed calls. Components never call `fetch` directly.
- Formatting helpers in one place: `formatTime12h('13:05') → '1:05 PM'`, `formatMinutes(95) → '1h 35m'`.
- Print stylesheet for the DTR preview; the PDF is still the official output.
- Env: only `VITE_API_BASE_URL`. Nothing secret in the bundle.

## 5. Spreadsheet import

| Option | Decision |
|---|---|
| **ExcelJS** | ✅ Use. Maintained, streaming reader, MIT |
| **csv-parse** | ✅ Use for CSV (streaming) |
| npm `xlsx` (SheetJS) 0.18.5 | ❌ Avoid. The npm release is outdated and has known CVEs (prototype pollution, ReDoS). Fixed builds ship only from the SheetJS CDN. |

Guards: max 20 MB, max 200k rows, one sheet (or a configured sheet name), uncompressed-size limit (zip-bomb), reject `.xls` / `.xlsm` unless HR's device only exports `.xls` (then convert with a sandboxed step, **to be decided after sample files (B1)**).

## 6. Background jobs

| Stage | Mechanism | When |
|---|---|---|
| Development | `InlineJobQueue` (runs immediately in-process) | Always |
| Phase 1 production | **pg-boss** (queues stored in PostgreSQL, retries, cron, singleton jobs) | Imports > a few thousand rows, period processing, bulk DTR generation, PDF rendering |
| Only if needed | Redis + BullMQ | Measured throughput or latency problems pg-boss can't handle |

Queues: `import-validate`, `process-attendance`, `generate-dtrs`, `render-dtr-pdf`, `employee-import`, `report-export`, `maintenance` (staging purge, token cleanup).
All jobs are idempotent and keyed (`singletonKey = dtrPeriodId` for processing).

## 7. DTR PDF generation

- **Template:** `templates/csc48/csc48.html` + CSS reproduces CSC Form No. 48 (header, 31 day rows, AM/PM arrival/departure, undertime hours/minutes, certification text, employee signature line, "In-Charge" verification line). Two copies per page if CvSU's template requires it.
- **Render:** Puppeteer `page.pdf({ format: 'A4' | 'Letter', printBackground: true })` in the worker. Fonts are bundled locally (no network).
- **Footer:** DTR version and a short verification code (first 10 hex chars of the SHA-256), which can be checked at `/dtrs/verify/:code`.
- **Template versioning:** `template_version` is stored with each document.
- **Alternative:** if CvSU requires filling its exact .xlsx/.docx file, use an ExcelJS fill + LibreOffice-headless conversion adapter behind the same `DtrPdfGenerator` port.

## 8. Environments

| Env | Purpose | Data |
|---|---|---|
| local | Developer machines (`docker compose up postgres`; apps on host) | Synthetic seed |
| staging | UAT with HR | **Anonymized** copy of real data |
| production | Live | Real data |

`.env.example` (no secrets):
```
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://app_user:***@postgres:5432/cvsu_dtr
DATABASE_MIGRATOR_URL=postgres://migrator:***@postgres:5432/cvsu_dtr
JWT_ACCESS_SECRET=***            JWT_ACCESS_TTL=900
REFRESH_TOKEN_TTL_DAYS=7
WEB_ORIGIN=https://dtr.cvsu.edu.ph
FILE_STORAGE_DRIVER=local        FILE_STORAGE_PATH=/data/files
BUSINESS_TIMEZONE=Asia/Manila
WORKER=false
SMTP_URL=                        # Phase 2
```

## 9. CI/CD pipeline

```
push/PR ─▶ install (yarn --immutable, cached) ─▶ lint ─▶ typecheck ─▶ unit tests ─▶ OpenAPI drift check
        ─▶ integration tests (Testcontainers Postgres) ─▶ build web + api ─▶ Docker images (tagged SHA)
main    ─▶ deploy staging ─▶ run migrations (migrator role) ─▶ smoke test ─▶ manual approval ─▶ production
```
Production deploy: backup → migrate → rolling restart → `/health/ready` check → rollback plan documented.

## 10. Hosting
- **Recommended:** university on-prem Linux server or a VPS (2 vCPU, 4–8 GB RAM, 80 GB SSD is enough for Phase 1) with Docker Compose.
- **Not suitable:** shared web hosting (no Docker or long-running Node, and Chromium is unavailable).
- TLS via the university certificate or Let's Encrypt. PostgreSQL is not exposed publicly.

## 11. Explicitly not used (Phase 1)
Microservices, Kubernetes, GraphQL, Kafka, event sourcing, CQRS, MongoDB, Elasticsearch, Redis (until needed), multiple UI kits, multiple ORMs, Redux.
