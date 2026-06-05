---
id: SPEC-003
title: "SPEC-003: SQL Connections contract (encryption, SSRF, permission family)"
status: Implemented
layer: contract
owner: Mariano Ravinale
created: 2026-06-04
updated: 2026-06-04
feature_paths:
  - src/modules/sql-connections
related_adrs: [ADR-012, ADR-001]
related_specs: [SPEC-002]
counterpart_spec: "spa-velocity#SPEC-003"
coordination_doc: ""
---

# SPEC-003: SQL Connections contract

> **Backfill** — current, test-backed contract. ACs map to existing Jest specs. The `ui` counterpart
> is `spa-velocity#SPEC-003`.

## 1. Summary (intended behavior)

Per-organization PostgreSQL connection CRUD with **AES-GCM encrypted, write-only** passwords
(never returned), **dual-key lazy rotation** (decrypt with current→previous, re-encrypt in the
background), an **SSRF guard** that rejects private/reserved hosts before any connection attempt, and
**refuse-on-reference** delete (409 if a project uses the connection). Permissions are the
`sql-connection:{read,create,update,delete}` family (ADR-012); test endpoints require `:update`
(they reveal reachability). Persistence is raw-SQL (ADR-001 fallback) on `org_sql_connection`.

## 2. Context & problem

Stores database credentials — the most sensitive data in the API. Load-bearing rules: encryption +
write-only redaction, SSRF pre-connection validation, and the permission family (ADR-012). Test
endpoints intentionally map to `:update`, not `:read`.

## 3. Scope

**In scope:** the 6 endpoints + their permissions, AES-GCM encryption + redaction, dual-key rotation
lazy-upgrade, SSRF guard, `allowedTables` validation, refuse-on-reference delete, credential testing
(ad-hoc / stored-password reuse / failed-no-persist), background status update, migration idempotency,
RBAC inheritance (org perms → sql-conn perms).

**Out of scope / non-goals (thin coverage — §9):** the raw-SQL repository adapter (no spec), the
tester timeout/late-init path, SSL JSONB roundtrip, `allowedTables` enforcement at chat time, generic
input validators (only `allowedTables` is directly tested).

## 4. Assumptions

1. [Confirmed] Password is AES-GCM encrypted and **never returned** (DTO has no password; responses use `toPublic`).
2. [Confirmed] Dual-key lazy upgrade: v0/previous-key decrypt schedules a background re-encrypt; failures don't surface (`sql-connections.service.spec.ts:97,138,162`).
3. [Confirmed] SSRF guard rejects private/reserved/loopback hosts (incl. `[::1]`) before connecting (`sql-connection-tester.spec.ts:12,37`).
4. [Confirmed] Delete refuses with 409 when a project references the connection; 404 for missing (`sql-connections.service.spec.ts:327,338,348`).
5. [Confirmed] Test endpoints require `sql-connection:update`; no endpoint uses legacy `organization:*` (`sql-connections.controller.spec.ts:47,67`).

## 5. Affected areas

- `src/modules/sql-connections/{api,application,domain,infrastructure}/*` — controller, service, tester, raw-SQL repository.
- Entity/migrations: `org_sql_connection` (encrypted password columns, `ssl` JSONB, `status`/`status_error`, `allowed_tables` JSONB); `sql-connections.migration.ts`.
- Crypto: AES-GCM via shared helper; `PROJECT_SOURCE_SECRET_KEY` (+ `_PREVIOUS` for rotation).
- Endpoints: `GET/POST /api/sql-connections`, `PATCH/DELETE /api/sql-connections/:id`, `POST /api/sql-connections/test`, `POST /api/sql-connections/:id/test`.

## 6. Acceptance criteria (mapped to existing tests)

| # | Criterion | Proving test |
|---|---|---|
| AC1 | Each endpoint carries the correct `sql-connection:*` permission; test endpoints = `:update`; no legacy `organization:*` | `sql-connections.controller.spec.ts:47,67` |
| AC2 | Dual-key rotation: v0 decrypt → re-encrypt; v1+current → no-op; previous-key → re-encrypt; upgrade-write failure not surfaced | `sql-connections.service.spec.ts:97,123,138,162` |
| AC3 | SSRF guard rejects private/reserved/loopback hosts (incl. bracketed IPv6) before connecting | `sql-connection-tester.spec.ts:12,37` |
| AC4 | `allowedTables`: null default; valid (un/qualified) arrays persist; malformed rejected (injection/quotes/leading-digit/3-dot/space/>200) | `sql-connections.service.spec.ts:225,232,242,254` |
| AC5 | Delete refuses with 409 on references; 404 for missing (short-circuits before reference check) | `sql-connections.service.spec.ts:327,338,348` |
| AC6 | testCredentials: ad-hoc; reuse stored password by connectionId; reject missing password/connection; failed test does NOT persist status | `sql-connections.service.spec.ts:377,401,425,439,454` |
| AC7 | Migrations run once on fresh DB, skip when applied; H1a adds `allowed_tables` only after 001 | `sql-connections.migration.spec.ts:24,35,41,50` |
| AC8 | RBAC inheritance: org:update → sql-conn:{create,update,delete}; org:read → sql-conn:read only; superadmin → all 4 (idempotent) | `rbac.migration.sql-connection.integration.spec.ts:183,207,225,280,300` |

## 7. Implementation plan

N/A — backfill. Future SQL-connection changes update this spec first.

## 8. Testing plan

Jest unit: `src/modules/sql-connections/**/*.spec.ts` (controller, service, tester, migration). Integration (real Postgres, `DATABASE_URL`): `rbac.migration.sql-connection.integration.spec.ts`. Run `npx jest src/modules/sql-connections`.

## 9. Risks & failure modes

- **Credentials**: encrypted at rest (AES-GCM), write-only, errors scrubbed of plaintext; rotation is lazy/background. The raw-SQL repository adapter is **untested** (no spec) → highest-value gap.
- SSL JSONB roundtrip + tester timeout path are **unverified**.
- `allowedTables` is validated/persisted but its **enforcement at chat-query time is the chat module's job** (not tested here).

## 10. Open questions

- Should `allowedTables` enforcement get its own test at the chat-resolver boundary (cross-module with SPEC-005)?

## Change Log

- 2026-06-04 · PR (backfill) · created · documents the SQL-connections contract; 8 ACs mapped to existing Jest specs (incl. the rotation, SSRF, and RBAC-inheritance behaviors).
