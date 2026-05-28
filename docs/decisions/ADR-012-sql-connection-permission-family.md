# ADR-012: SQL connection permission family and backwards-compatible grant inheritance

**Status:** Accepted
**Date:** 2026-05-27
**Deciders:** Engineering (api-velocity)

## Context

Today the `sql_connections` HTTP controller at [src/modules/sql-connections/api/controllers/sql-connections.controller.ts](../../src/modules/sql-connections/api/controllers/sql-connections.controller.ts) authorizes the four CRUD actions plus two `test` endpoints using two permissions from the `organization:*` family:

- `organization:read` — `GET /api/sql-connections`
- `organization:update` — `POST /api/sql-connections`, `PATCH /:id`, `DELETE /:id`, `POST /test`, `POST /:id/test`

This is a usable wartime gate but a coarse one. `organization:update` is the most consequential permission in the `organization:*` family — it also authorizes editing the org's name/slug/metadata and is the precondition for changing the Airweave allowlist. Coupling SQL connection management to it forces an "all or nothing" policy: any role that's allowed to add a Postgres credential to a project is also allowed to rename the organization, and vice versa.

The PR introducing this ADR ([branch `fix/chat-table-normalizer` + follow-up `feat/main-menu-collections-sql`]) promotes SQL connections from an embedded section inside the Edit-Organization admin modal to a first-class page under `Main → SQL Connections` in the SPA. Once the page is reachable by any user with `sql-connection:read`, the permission contract needs to be expressible independently of `organization:*` — otherwise the new page's "who can see this" gate ties back to "who can edit the org," which is the wrong access boundary for a project-data-source primitive.

Two further constraints shape the resolution:

1. **Backwards compatibility is non-negotiable.** Every role that today can create/update/delete a SQL connection must retain that capability the instant the new decorators ship — including custom user-edited roles created via the Roles & Permissions UI. We cannot ship a migration that silently revokes capability from any role.
2. **Custom roles do not participate in the `syncRolePermissions` re-sync.** The existing migration pattern (see [rbac.migration.ts:684](../../src/modules/admin/rbac/rbac.migration.ts) and the `addAirweavePermissions` precedent at line 1518) only re-syncs the canonical default-named roles (`admin`, `manager`, `member`). Custom roles are left untouched. A constants-only update therefore preserves capability for default roles but does NOT propagate to custom roles — those need a separate additive grant pass.

The choice this ADR resolves is twofold: **what new permissions exist**, and **how they are granted on deploy without revoking anyone's existing capability**.

## Decision

We will adopt the following four coupled rules.

**Decision 1 — Permission family.** Introduce a new top-level resource `sql-connection` with four actions: `read`, `create`, `update`, `delete`. Add to the canonical catalog in `src/permissions.ts` and to the runtime `permissions` table via tracked migration `rbac_021_add_sql_connection_permissions`. No `manage-sources` action — SQL connections do not have nested resources, so the `airweave:manage-sources` asymmetry does not transfer.

**Decision 2 — Controller decorator swap.** The six endpoints on `sql-connections.controller.ts` swap their `@RequirePermissions` decorators:

| Endpoint | Before | After |
|---|---|---|
| `GET /` | `organization:read` | `sql-connection:read` |
| `POST /` | `organization:update` | `sql-connection:create` |
| `PATCH /:id` | `organization:update` | `sql-connection:update` |
| `DELETE /:id` | `organization:update` | `sql-connection:delete` |
| `POST /test` (ad-hoc credentials) | `organization:update` | `sql-connection:update` |
| `POST /:id/test` (saved connection) | `organization:update` | `sql-connection:update` |

The two `test` endpoints map to `sql-connection:update` rather than `:read` because they exercise the credential and reveal whether a configured target is reachable — i.e., they leak operational metadata that a read-only role should not be able to enumerate. They are not destructive but they are not strictly idempotent observation either; the closest existing grade is "update."

**Decision 3 — Inheritance migration policy.** The tracked migration `rbac_021` grants the new permissions to existing roles using two coordinated mechanisms:

a) **Default roles (admin/manager/member)** are re-synced via `syncRolePermissions` from the `ORGANIZATION_*_DEFAULT_PERMISSIONS` constants, which gain the new entries. Re-sync is idempotent and runs for both global default roles (`organization_id IS NULL`) and every per-organization clone of those roles. Distribution mirrors the source `organization:*` grants:

- Admin (`organization:read|update`): gains all four `sql-connection:*`.
- Manager (`organization:read|update`): gains all four `sql-connection:*`.
- Member (`organization:read` only): gains `sql-connection:read` only.

b) **Custom roles** receive the new permissions via an additive `INSERT ... ON CONFLICT DO NOTHING` pass keyed off existing grants:

- Any role currently holding `organization:update` is granted `sql-connection:create|update|delete`.
- Any role currently holding `organization:read` is granted `sql-connection:read`.

This second pass also covers default roles harmlessly (the constants re-sync already added the same rows; `ON CONFLICT` makes it a no-op). The end-state guarantee: for every role in the system at migration time, post-migration capability ⊇ pre-migration capability for the SQL-connection surface. No role loses any ability.

Superadmin is unaffected — it bypasses permission checks at the guard layer (see [PermissionsGuard](../../src/shared/guards/permissions.guard.ts)) and additionally receives all permissions at the table level for query consistency (per the established `addAirweavePermissions` pattern).

**Decision 4 — Post-deploy permission lifecycle is the user's choice.** Once `rbac_021` has run, the new permissions are decoupled from `organization:*`. Tightening the policy (e.g., revoking `sql-connection:create` from managers while keeping `organization:update`) or loosening it (e.g., granting `sql-connection:read` to a member role that lacks `organization:read`) is a normal Roles & Permissions UI operation. The migration is a one-time backwards-compat bridge, not an ongoing coupling.

## Alternatives considered

- **Alt A — Keep using `organization:*`.** Rejected. Keeps the policy coupled to org-administration; means the new `Main → SQL Connections` page is gated on `organization:read`, which a member who needs to use SQL connections in their project may or may not have. Worse, granting it requires giving the user the ability to inspect the entire organization. The whole point of promoting SQL connections to Main is that access is a function of using them, not administering the org.

- **Alt B — Introduce `sql-connection:*` but grant nothing on deploy.** Register the new permissions, swap decorators, but let users assign them post-deploy via the Roles & Permissions UI. Rejected. Day-of-deploy regression: every existing admin, manager, and custom role that today can manage SQL connections via `organization:update` would receive 403 the moment the decorators swap. The operator's only recovery is to log in, navigate to Roles & Permissions, and manually grant the new permissions to every affected role — including custom roles whose existence they may not remember. Unacceptable user experience for what should be an invisible upgrade.

- **Alt C — Single inheritance pass for all roles, no constants update.** Use the additive `INSERT ... ON CONFLICT DO NOTHING` pass for every role (default + custom), skip the constants update. Rejected. Future re-syncs of the default roles (e.g., when adding the next permission family) would call `syncRolePermissions` against `ORGANIZATION_ADMIN_DEFAULT_PERMISSIONS` which omits `sql-connection:*` — `syncRolePermissions` DELETEs rows not in the allowlist, silently stripping the new permissions from the default admin/manager/member roles. The constants update is load-bearing for the next migration's correctness, not just current state.

- **Alt D — Use a single `sql-connection:manage` permission instead of four.** Rejected. The four CRUD actions follow the established pattern (`project:*`, `airweave:*` are both granular). A `manage`-style coarse grant would be an outlier and lose the ability to express read-only personas. The marginal complexity of four entries vs one is trivial.

## Consequences

- **Positive:**
  - SQL connection access is now independently policy-able from org administration.
  - The `Main → SQL Connections` page gates on the right permission for the right user persona.
  - Zero regression at deploy: every role keeps every capability it had.
  - Establishes the inheritance-migration pattern (constants re-sync + additive custom-role pass) as the canonical template for the next "promote an embedded surface to a top-level resource family" change.

- **Negative:**
  - Adds 4 entries to the `permissions` table + ~N×3 to ~N×4 entries to `role_permissions` (where N is the count of pre-existing roles with `organization:read` or `organization:update`). Storage-wise negligible.
  - Custom roles that the user later wants to scope tighter — e.g., a "Project Editor" role with `organization:update` but explicitly without SQL-connection management — will need a follow-up manual revoke via the UI. The migration cannot infer this intent.
  - The two `test` endpoints' choice of `sql-connection:update` (rather than `:read`) is a defensible-but-debatable call. Documented here so the next reader doesn't have to re-derive the rationale.
  - **`syncRolePermissions` DELETE-allowlist semantics on default roles.** This migration re-syncs the canonical default-named roles (`admin`, `manager`, `member` — both global and per-org cloned) from the updated `ORGANIZATION_*_DEFAULT_PERMISSIONS` constants. The helper deletes any `role_permissions` row not in the constants list before inserting. If an operator manually added a permission to a default-named role via the Roles & Permissions UI BEFORE the migration runs, that customization is silently stripped. This is consistent with how all 8 prior migrations of this shape behave; it is the implicit contract that default-named roles are system-controlled, not user-editable in the long run. Custom roles are unaffected (no DELETE pass touches them). Surfaced here so the next reviewer doesn't derive it from migration archaeology.
  - **Atomicity is convergence-via-retry, not transactional.** The migration is NOT wrapped in `db.transaction` — `syncRolePermissions` already does its own DELETE-then-INSERT against the top-level connection, so any wrapper would be a false-atomicity claim. Recovery semantics: `recordMigration` only runs after the whole function completes; on mid-flight crash, `hasMigrationRun` stays false, and `ON CONFLICT DO NOTHING` on every INSERT (plus `syncRolePermissions` convergence to the constants snapshot) makes the re-run safe. A brief window where a default role has fewer permissions during the helper's DELETE-then-INSERT pair exists — the same window all 8 prior migrations of this shape have. Eliminating it requires threading the transactional `query` callback through `syncRolePermissions`, tracked as a follow-up across all such migrations.

- **Follow-ups:**
  - Audit other endpoints currently gated on `organization:update` for the same "promotable to its own permission family" treatment. Candidates from a quick grep: none obvious in the current code, but the pattern is now established.
  - If multi-tenancy isolation tightens further (e.g., per-database-instance permissions), the four actions are the natural extension point — actions can grow without renaming the resource.
  - **SQL connections superadmin/cross-org asymmetry vs Airweave.** ADR-011 amendment 5 enforces `verifyCallerMembership` on body-level `organizationId` for `POST /api/airweave/collections`, applying to superadmin too (membership is a data-isolation primitive). The sibling endpoint `POST /api/sql-connections` accepts a body-level `organizationId` but does NOT re-validate membership — the existing `SqlConnectionsService.requireOrg` enforces "non-superadmin's organizationId must equal active org" but lets superadmin point at any org. This means a superadmin who is not a member of org-B can create a SQL connection (a Postgres credential) inside org-B's tenancy. Acceptable today because superadmin is a global-platform role and SQL-connection creation is operationally similar to other cross-tenant superadmin actions, but the inconsistency is silent. **Follow-up:** either apply the same `verifyCallerMembership` pattern to SQL connections (extract membership-check service to a shared module first; today it lives in `AirweaveAuthorizationService`), or explicitly carve out "superadmin may create SQL connections cross-org" as a documented exception in `repo-conventions` § RBAC.
  - **Transactional `syncRolePermissions` across all 8 affected migrations.** See Negative > "Atomicity is convergence-via-retry, not transactional." Threading the captured `query` callback through `syncRolePermissions` would close the DELETE-then-INSERT-during-crash window for all migrations of this shape.
  - **System-controlled marker on default roles in the Roles & Permissions UI.** Surface that default-named roles (`admin`/`manager`/`member`) reset on every permission-family migration, so the UI can warn or prevent manual permission edits that will not survive the next deploy.

## References

- Source files where the decision is visible:
  - [src/modules/sql-connections/api/controllers/sql-connections.controller.ts](../../src/modules/sql-connections/api/controllers/sql-connections.controller.ts) — the decorator swap site.
  - [src/modules/admin/rbac/rbac.migration.ts](../../src/modules/admin/rbac/rbac.migration.ts) — the `rbac_021_add_sql_connection_permissions` migration + updated `ORGANIZATION_*_DEFAULT_PERMISSIONS` constants.
  - [src/permissions.ts](../../src/permissions.ts) — the canonical Better Auth statement with the new resource.
- Skills / `CLAUDE.md` sections that enforce it:
  - `repo-conventions` § "RBAC scope contract" — cites this ADR for the SQL-connection permission family.
  - `documentation-and-adrs` § "Layered-router principle" — this ADR is the canonical *why* for the inheritance migration policy.
- Related ADRs:
  - [ADR-001](./ADR-001-typeorm-first-persistence.md) — raw-SQL `INSERT ... ON CONFLICT DO NOTHING` is the explicit fallback for catalog mutations.
  - [ADR-002](./ADR-002-rbac-scope-all-returns-400.md) — `scope=all` semantics interact with the new permissions for superadmin-only filtering.
  - [ADR-011](./ADR-011-airweave-ownership-via-org-metadata.md) — sibling permission family (`airweave:*`); same `addAirweavePermissions` pattern is the template for `addSqlConnectionPermissions`.
