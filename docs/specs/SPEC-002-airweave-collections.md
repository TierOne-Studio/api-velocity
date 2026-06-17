---
id: SPEC-002
title: "SPEC-002: Airweave Collections — ownership, CRUD, source-connections, RAG"
status: Draft
layer: contract
owner: Mariano Ravinale
created: 2026-06-17
updated: 2026-06-17
feature_paths:
  - src/modules/airweave
  - src/modules/projects/application/providers/airweave-collection.provider.ts
  - src/modules/projects/projects.migration.ts
related_adrs: [ADR-011]
related_specs: [SPEC-000]
counterpart_spec: "spa-velocity#SPEC-002"
coordination_doc: "docs/airweave-collections-rename-coordination-plan.md"
---

# SPEC-002: Airweave Collections — ownership, CRUD, source-connections, RAG

## 1. Summary (intended behavior)

An organization can own one or more **Airweave Collections** — collections hosted upstream by
the third-party Airweave service and surfaced through the `api/airweave` REST surface. Ownership
is recorded in an org-metadata allowlist (`organization.metadata.allowedAirweaveCollectionIds`),
not in a local table: the upstream catalog is filtered to the collections the caller's active
organization owns. Admins manage collections (list / create / rename / delete), attach
**source-connections** to them (direct-auth or via the Airweave Connect catalog widget using a
short-lived session token), and attach a collection to a project as an `airweave_collection`
data source so the chat agent retrieves from it at query time. Every read and mutation is gated
by RBAC (`airweave:*`) and by per-collection ownership; cross-org access is filtered out by the
allowlist and a fail-shut ownership guard.

The persisted/wire contract uses the `airweaveCollection*` naming (`airweaveCollectionReadableId`,
`airweaveCollectionId`, `airweaveCollectionName`); the `airweave`-prefixed route namespace, RBAC
resource, DB enum value (`airweave_collection`), and metadata key are unchanged.

## 2. Context & problem

The Airweave Collections feature was built under `ADR-011` (ownership via `organization.metadata`
allowlist) before the spec-first workflow (SPEC-000) existed, so it had no governing SPEC. A
follow-up branding pass renamed the bare `collection*` identifiers (wire JSON fields, persisted
`project_data_source.config` keys, and internal symbols) to `airweaveCollection*` so the feature
reads consistently as "Airweave Collections" end-to-end. Because that touched behavioral
`src/**` (a wire contract + a data migration), the spec-first gate requires the governing SPEC to
exist and reflect the contract. This SPEC backfills the as-built feature and pins the renamed
contract; the rename itself is documented in `ADR-011` Amendment 6 and the cross-repo coordination
doc. The paired SPA behavior is `spa-velocity#SPEC-002`.

## 3. Scope

**In scope:**

- CRUD over Airweave Collections via `api/airweave/collections` (list / get / create / update /
  delete / search), all RBAC-gated and ownership-filtered to the caller's organization.
- Ownership model: the `allowedAirweaveCollectionIds` org-metadata allowlist; LIST is filtered by
  it, single-collection reads/mutations are gated by `AirweaveOwnershipGuard`.
- Source-connections within a collection: direct-auth create, list, update, delete, reauth, and
  the `connect/session` session-token endpoint that powers the Airweave Connect catalog widget.
- Project integration: the `airweave_collection` data-source kind + `AirweaveCollectionProvider`,
  with the persisted `config.{airweaveCollectionReadableId,airweaveCollectionName}` shape.
- Chat integration: the agent retrieves from a project's attached Airweave Collections.
- The `airweaveCollection*` rename of wire fields, persisted config keys, and internal symbols,
  plus forward migration `projects_005_rename_airweave_config_keys`.
- RBAC scopes: `airweave:{read,create,update,delete,manage-sources}`.

**Out of scope / non-goals:**

- The Airweave SDK surface (`client.collections.*`, the upstream `readable_id` field) — external,
  not renamed, not governed here.
- The SPA screens (paired `ui` spec, `spa-velocity#SPEC-002`).
- Changing the route path (`/api/airweave/collections`), the DB enum value (`airweave_collection`),
  the RBAC resource (`airweave`), or the metadata key (`allowedAirweaveCollectionIds`) — all already
  `airweave`-named and intentionally unchanged.
- A local collections table — collections live upstream in Airweave; only the ownership allowlist
  and the per-project source config are persisted locally.

## 4. Assumptions

1. [Confirmed] Ownership is the org-metadata allowlist `allowedAirweaveCollectionIds` (a JSON
   string array on `organization.metadata`); there is no local collections table.
2. [Confirmed] LIST returns the upstream catalog filtered to the active org's allowlist; a
   collection not in the allowlist is invisible to non-superadmin callers.
3. [Confirmed] Single-collection reads/mutations are gated by `AirweaveOwnershipGuard`, which reads
   the collection id from the route param (`@RequireAirweaveOwnership`) or, for `connect/session`,
   from the request body (`@RequireAirweaveOwnershipFromBody('airweaveCollectionId')`).
4. [Confirmed] A missing/blank ownership id fails shut (`BadRequestException`) before the ownership
   check runs; an unowned id is denied per the read-lockdown flag (`ADR-011` Decision 4).
5. [Confirmed] Deleting a collection still referenced by a project's `airweave_collection` data
   source is refused with `409 ConflictException` carrying `airweaveCollectionReadableId` + the
   referencing projects; no cascade.
6. [Confirmed] Persisted source config uses `airweaveCollectionReadableId` / `airweaveCollectionName`;
   the migration renames existing rows forward and historical migrations (002/003) that wrote the
   old keys are immutable.
7. [Confirmed] The upstream Airweave SDK field `readable_collection_id` / `readable_id` and the
   `client.collections.*` methods are external and keep their names.

> Correct any Unconfirmed assumption now, or implementation proceeds on it. (None are Unconfirmed.)

## 5. Affected areas

**Module:** `src/modules/airweave` (api / application / infrastructure), registered via
`airweave.module.ts` and wired in `app.module.ts`.

**Endpoints** (`@Controller('api/airweave')`, behind `PermissionsGuard` + `AirweaveOwnershipGuard`):

| Method & path | Permission | Ownership | Behavior |
|---|---|---|---|
| `GET /collections` | `airweave:read` | allowlist filter | List org's collections |
| `POST /collections` | `airweave:create` | active-org / body `organizationId` membership | Create a collection (allowlist add) |
| `GET /collections/:collectionId` | `airweave:read` | param | Get one collection |
| `PATCH /collections/:collectionId` | `airweave:update` | param | Rename a collection |
| `DELETE /collections/:collectionId` | `airweave:delete` | param | Delete → 409 if referenced; response `{deleted, airweaveCollectionId}` |
| `POST /collections/:collectionId/search` | `airweave:read` | param | Search within a collection |
| `POST /collections/:collectionId/source-connections` | `airweave:manage-sources` | param | Create a direct-auth source-connection |
| `GET /sources/:collectionId` | `airweave:read` | param | List a collection's source-connections (response carries `airweaveCollectionReadableId`) |
| `POST /connect/session` | `airweave:manage-sources` | **body** `airweaveCollectionId` | Issue an Airweave Connect session token |

**Wire JSON fields (renamed):** request body `airweaveCollectionId` (`connect/session`); response
fields `airweaveCollectionReadableId` (source-connection summary), `airweaveCollectionId`
(delete response), and the delete-conflict body `airweaveCollectionReadableId`.

**Persistence (no collections table):**

- `organization.metadata.allowedAirweaveCollectionIds` (JSON string array) — the ownership
  allowlist; mutated by `AdminOrganizationsService`/`AdminOrgDatabaseRepository` (`jsonb_set`,
  field-local, idempotent).
- `project_data_source` rows with `kind='airweave_collection'` and
  `config = { airweaveCollectionReadableId, airweaveCollectionName }`.

**Migration:** `projects_005_rename_airweave_config_keys` (`projects.migration.ts`) — one
idempotent `jsonb` UPDATE scoped to `kind='airweave_collection'` that renames the two config keys
forward (strip-and-rebuild, no null injection on partial rows); non-airweave rows untouched;
re-run is a no-op. Historical migrations 002/003 still write the old keys and are immutable; the
`:167` idempotency read intentionally stays on the old key.

**RBAC scopes** (`src/permissions.ts`): `airweave:{read,create,update,delete,manage-sources}` —
owner/admin all five; manager read/create/update/manage-sources; member read.

**Ownership guard:** `AirweaveOwnershipGuard` + `@RequireAirweaveOwnership(routeParam)` /
`@RequireAirweaveOwnershipFromBody(bodyField)` (`require-airweave-ownership.decorator.ts`).
The read-lockdown observability log key is `airweaveCollectionReadableId` (renamed; `ADR-011`
Decision 4).

**Project + chat integration:** `AirweaveCollectionProvider` (`kind='airweave_collection'`) reads
`config.airweaveCollectionReadableId`; `chat-router.service.ts` reads `config.airweaveCollectionName`
for the source summary.

## 6. Acceptance criteria (falsifiable; each maps to a test)

| # | Criterion (observable behavior) | Proving test |
|---|---|---|
| AC1 | LIST returns the upstream catalog filtered to the active org's allowlist; create/rename/delete delegate correctly; single-collection reads are org-scoped | `src/modules/airweave/api/controllers/airweave.controller.spec.ts`; `src/modules/airweave/application/services/airweave.service.spec.ts`; `src/modules/airweave/application/services/airweave-authorization.service.spec.ts` |
| AC2 | RBAC `airweave:{read,create,update,delete,manage-sources}` is enforced per route | `src/modules/airweave/api/controllers/airweave.controller.spec.ts` |
| AC3 | Ownership guard reads the route param for `/collections/:id` routes and the **body** field `airweaveCollectionId` for `connect/session`; the old `collectionId` body field is rejected fail-shut (400) before `assertOwnership` runs | `src/modules/airweave/api/guards/airweave-connect-session-ownership.spec.ts`; `src/modules/airweave/api/guards/airweave-ownership.guard.spec.ts` |
| AC4 | Deleting a referenced collection returns `409` whose body carries `airweaveCollectionReadableId` + the referencing projects; Airweave + allowlist are left untouched | `src/modules/airweave/application/services/airweave.service.spec.ts` |
| AC5 | Migration `projects_005` renames `config` keys for `kind='airweave_collection'` rows (both / partial-no-null-injection / empty / non-airweave-untouched / idempotent) against real Postgres; the runtime `config->>'airweaveCollectionReadableId'` reference query resolves a renamed row | `test/projects-airweave-config-migration.e2e-spec.ts` |
| AC6 | `AirweaveCollectionProvider` only handles `airweave_collection` sources and reads the renamed config keys; the chat-router source summary reads `config.airweaveCollectionName` | `src/modules/projects/application/providers/airweave-collection.provider.spec.ts`; `src/modules/chat/application/services/chat-router.service.spec.ts` |
| AC7 | Source-connection create/list responses carry `airweaveCollectionReadableId`; `connect/session` accepts `airweaveCollectionId` and the decorator metadata pins that body field | `src/modules/airweave/application/services/airweave.service.spec.ts`; `src/modules/airweave/api/controllers/airweave.controller.spec.ts`; `src/modules/airweave/api/guards/airweave-connect-session-ownership.spec.ts` |

## 7. Implementation plan

The feature shipped previously (PR #23 / `ADR-011`); this SPEC backfills it and the rename ships
as the slices below (mirrors `feat/airweave-collections-rename`; each carried its tests).

1. **Migration** — `files:` `projects.migration.ts` (`projects_005`). `tests:`
   `projects-airweave-config-migration.e2e-spec.ts`. `risk:` data loss / non-idempotency.
   `slice:` ~80 LOC.
2. **Persisted-config readers/writers** — `files:` `project.dto.ts`, `airweave-collection.provider.ts`,
   `projects.database-repository.ts` (runtime SQL `:211`; `:167` kept), `projects.service.ts`,
   `chat-router.service.ts`. `tests:` provider/repo/service/chat specs. `risk:` missed reader.
   `slice:` ~90 LOC.
3. **Wire fields + body decorator** — `files:` `airweave.service.ts` (summary/conflict),
   `airweave.controller.ts` (inline `CreateConnectSessionBody`, body read, decorator, DELETE
   response), `require-airweave-ownership.decorator.ts`. `tests:` controller/guard specs +
   `airweave-connect-session-ownership.spec.ts`. `risk:` compiler-invisible decorator↔body coupling.
   `slice:` ~80 LOC.
4. **Internal symbols/vars** — `files:` bare DTOs, admin/organizations allowlist params, guard var.
   `tests:` full backend suite + residual grep. `risk:` over-rename of kept route param.
   `slice:` mechanical.
5. **ADR + SPEC** — `files:` `ADR-011` Amendment 6, this SPEC, coordination doc. `slice:` docs.

## 8. Testing plan

- **Unit (Jest `*.spec.ts`):** controller route/RBAC wiring + delete response (AC1, AC2, AC4, AC7);
  authorization-service allowlist filtering (AC1); ownership guard param vs body extraction + the
  decorator-metadata coupling (AC3, AC7); provider kind-guard + chat-router summary (AC6).
- **e2e / integration (`test/*.e2e-spec.ts`, real Postgres):** `projects-airweave-config-migration.e2e-spec.ts`
  exercises migration `projects_005` across all data variants and the runtime `config->>` reference
  query against a seeded row (AC5).

The `connect/session` body↔guard coupling (AC3/AC7) is proven deterministically by
`airweave-connect-session-ownership.spec.ts` (real decorator metadata + real guard), since the live
`airweave-live.spec.ts` (paired SPA repo) depends on the real Airweave service.

## 9. Risks & failure modes

- **Compiler-invisible wire coupling** (`connect/session` body field ↔ decorator string): a rename
  on one side only would 400 every call; `tsc` can't catch it. Mitigation: AC3/AC7 coupling spec
  asserts the new field works AND the old field is rejected.
- **Migration non-idempotency / null injection** (partial/boundary): the `jsonb` UPDATE guards each
  key with `config ? key` so an absent key is not set to `null`; re-run is a no-op. Mitigation: AC5
  real-Postgres variants.
- **Cross-org leak** (tenancy): LIST is allowlist-filtered and single-collection access is guarded;
  the delete-conflict body returns only the caller's own readable id. Mitigation: AC1, AC4.
- **Editing immutable history**: `projects_005` renames forward; migrations 002/003 keep the old
  keys and the `:167` idempotency read stays on the old key — renaming it would desync 003's dedup
  (duplicate rows). Mitigation: documented KEEP; only the runtime read (`:211`) renames.
- **SRE observability drift**: three structured-log keys rename (`airweave.read_would_403` +
  `airweave.source_connection.{created,deleted}`). Mitigation: flagged in `ADR-011` Amendment 6 for
  dashboard updates.

## 10. Open questions

None blocking. Deferred (non-blocking): a claim flow for legacy globally-readable collections and
an allowlist reconciler cron (both noted as future work in `ADR-011`); status moves to
`Implemented` when this PR merges and the SPEC is reconciled with the merged diff.

## Change Log

Append-only. Newest first.

- 2026-06-17 · PR #34 (feat/airweave-collections-rename) · Backfills the governing contract SPEC for
  the as-built Airweave Collections feature (`ADR-011`) and pins the `airweaveCollection*` rename of
  the wire JSON fields, the persisted `project_data_source.config` keys (forward migration
  `projects_005`), and internal symbols. Route path, DB enum `airweave_collection`, RBAC `airweave:*`,
  metadata `allowedAirweaveCollectionIds`, and the Airweave SDK surface are unchanged. Created to
  satisfy the spec-first gate (SPEC-000) for the behavioral `src/modules/airweave` + `projects`
  change; ships with `ADR-011` Amendment 6 and `spa-velocity#SPEC-002`. Status stays `Draft` until
  merge. · No assumption corrections.
