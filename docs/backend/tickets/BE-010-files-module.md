---
id: BE-010
title: Files module (stored_files, local storage)
type: Task
priority: P1
status: TODO
epic: E2 Attendance import
module: files
week: 2
day: 2026-10-12
estimate_h: 2
depends_on: [BE-003]
blocked_by: []
phase: 1
tags: [cvsu-dtr, backend, ticket]
---

# BE-010 — Files module (stored_files, local storage)

Roadmap: [[CVSU-DTR/v3/backend/BACKEND-ROADMAP|BACKEND-ROADMAP]] · Skills: `dtr-backend`, `dtr-security`

## 1. Background & problem
Uploaded exports and generated PDFs must be stored safely (random keys, outside the web root) and only served through authorized endpoints.

## 2. Objective
A leaf `files` module behind a `FileStorage` port, with a local-disk adapter.

## 3. Scope
**In**
- [ ] Migration (start of `0005_import_and_raw`): `stored_files`
- [ ] `FileStorage` port: `save(stream, meta) → { id, storageKey, sha256, size }`, `open(id) → stream`, `delete(id)`
- [ ] `LocalDiskStorage`: `FILE_STORAGE_PATH`, key = random UUID path (never the user filename), SHA-256 computed while streaming
- [ ] `FilesService.download(res, fileId, { filename })` helper: `Content-Disposition: attachment`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`
- [ ] Sanitize `original_name` (strip path parts / control chars)

**Out**
- S3 adapter (later), public `/files/:id` endpoint (1B)

## 4. Acceptance criteria
- [ ] Saved file path contains no user-supplied text
- [ ] `sha256` and `size_bytes` stored correctly
- [ ] `files` imports nothing from business modules

## 5. Tests
Unit: LocalDiskStorage with a temp dir (save/open/hash). 

## 6. References
[[CVSU-DTR/v3/API-DESIGN]] §8 · [[CVSU-DTR/v3/DATABASE-MAPPING]] §6 · [[CVSU-DTR/v3/DESIGN-PATTERNS]] §5
