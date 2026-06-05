---
id: SPEC-006
title: "SPEC-006: Projects contract (CRUD, data-source attachment, org scoping)"
status: Implemented
layer: contract
owner: Mariano Ravinale
created: 2026-06-04
updated: 2026-06-04
feature_paths:
  - src/modules/projects
related_adrs: [ADR-002]
related_specs: [SPEC-002, SPEC-003, SPEC-004]
counterpart_spec: "spa-velocity#SPEC-006"
coordination_doc: ""
---

# SPEC-006: Projects contract

> **Backfill** — current, test-backed contract. ACs map to existing Jest specs. The `ui` counterpart
> is `spa-velocity#SPEC-006`.

## 1. Summary (intended behavior)

A project (org-scoped, unique name per org) groups data sources of three kinds: `airweave_collection`
(validated against the org's Airweave allowlist — superadmin bypass), `database` (resolved from an org
SQL connection), and `external` (declared but `NotImplemented`). CRUD + source attach/detach are
RBAC-gated (`project:{read,create,update,delete,manage-sources}`) and follow the ADR-002 scope contract
(`scope=all` superadmin-only → non-superadmin 400; cross-org → 403; active-org required). Projects
cascade-delete their sources; deleting an Airweave collection checks references scoped by collection **and** org.

## 2. Context & problem

Projects bind SQL connections (SPEC-003) + Airweave collections (SPEC-004) and scope Chat (SPEC-005);
undocumented. Load-bearing rules: the org-allowlist check on Airweave attach, the SQL-connection
resolution on database attach, unique-name-per-org, and the org-scoped reference check (security H1).

## 3. Scope

**In scope:** the 7 endpoints + RBAC + ADR-002 scope contract, create validation (name+org required,
empty/duplicate rejected), source attachment (airweave allowlist + superadmin bypass, database
resolution, external NotImplemented, collection-id required), source removal (404/success),
cross-org rejection, the org-scoped reference query (security H1).

**Out of scope / non-goals (thin coverage — §9):** **DB-repository CRUD integration (mostly mocked —
only the security reference-query is repo-tested)**; `countConversations`/`toSummary` async error
handling; migration idempotency (002 backfill / 003 allowlist seed); JSONB config edge cases; pagination.

## 4. Assumptions

1. [Confirmed] ADR-002 scope: non-superadmin `scope=all` → 400; superadmin cross-org via `scope=all`; cross-org orgId → 403; non-superadmin no active org → 403 (`projects.controller.spec.ts:58,90,103`; `projects.service.spec.ts:156,164`).
2. [Confirmed] Create requires name + organizationId; empty name → 400; duplicate name per org → 409 (`projects.controller.spec.ts:109`; `projects.service.spec.ts:175,190`).
3. [Confirmed] Airweave attach enforces the org allowlist; superadmin bypasses; collection-id required (`projects.service.spec.ts:220,267,296,415`).
4. [Confirmed] Database attach resolves the org SQL connection (`findByIdForAttach`); external → NotImplemented (`projects.service.spec.ts:338,378`).
5. [Confirmed] The Airweave reference query is scoped by BOTH collection readable-id AND organization-id, DISTINCT (security H1) (`projects.database-repository.spec.ts:29`).
6. [Unconfirmed] DB-repository CRUD (create/update/delete/list/counts) — mocked in service tests, not integration-tested (§9).

## 5. Affected areas

- `src/modules/projects/{api,application,domain,infrastructure}/*` — controller, service, raw-SQL repository.
- Cross-module: `AirweaveService.getCollection` + org allowlist; `SqlConnectionsService.findByIdForAttach` (SPEC-003/004).
- Entities/migrations: `project` (unique org+name, FK org/user, cascade), `project_data_source` (kind check, `config` JSONB, status); `projects.migration.ts` (001–003: create, backfill "General", seed allowlist).
- Endpoints: `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`, `POST/DELETE /api/projects/:id/sources[/:sourceId]`.

## 6. Acceptance criteria (mapped to existing tests)

| # | Criterion | Proving test |
|---|---|---|
| AC1 | Endpoints apply PermissionsGuard; non-superadmin w/o active org → 403; superadmin list w/o org allowed | `projects.controller.spec.ts:49,58,77` |
| AC2 | `scope=all`: superadmin → scopeMode:all; non-superadmin → 400 | `projects.controller.spec.ts:90,103`; `projects.service.spec.ts:131,144` |
| AC3 | Cross-org: non-superadmin orgId ≠ active → 403; matching org allowed | `projects.service.spec.ts:156,164` |
| AC4 | Create: name+org required (400); empty name (400); duplicate name per org (409); no-sources happy path | `projects.controller.spec.ts:109`; `projects.service.spec.ts:175,190,201` |
| AC5 | Create+airweave: allowlist check; outside allowlist → 403; superadmin bypass | `projects.service.spec.ts:220,267,296` |
| AC6 | addSource: database resolves org connection; external → NotImplemented; cross-org → 403; airweave needs collection-id | `projects.service.spec.ts:338,378,394,415` |
| AC7 | removeSource: missing → 404; success → `{deleted:true}` | `projects.service.spec.ts:432,441` |
| AC8 | resolveProjectSources: wrong org → 403; matching org → sources | `projects.service.spec.ts:456,464` |
| AC9 | Airweave reference query scoped by collection readable-id AND org-id (DISTINCT); empty when none | `projects.database-repository.spec.ts:29,67` |

## 7. Implementation plan

N/A — backfill. Next change here should add DB-repository integration tests (§9).

## 8. Testing plan

Jest unit: `src/modules/projects/**/*.spec.ts` (controller: 11, service: ~24, repository: 2 security-focused). Run `npx jest src/modules/projects`. (DB-repo CRUD would benefit from a testcontainer suite — §9.)

## 9. Risks & failure modes

- **DB-repository CRUD is mostly mocked (MED):** only the security reference-query is repo-tested; create/update/delete/list/counts rely on service-level mocks → schema/SQL edge cases uncaught until runtime. Highest-value gap.
- `external` source kind is declared but `NotImplemented` — don't mistake the type for a working feature.
- Migration backfill (General project) + allowlist seed idempotency are **unverified**.
- Source status is mirrored at attach time; the chat resolver is expected to re-read at query time (SPEC-005).

## 10. Open questions

- Should source-status be re-resolved on read rather than mirrored at attach? (Coordinate with SPEC-005.)

## Change Log

- 2026-06-04 · PR (backfill) · created · documents the Projects contract; 9 ACs mapped to existing Jest specs; DB-repo integration gap flagged.
