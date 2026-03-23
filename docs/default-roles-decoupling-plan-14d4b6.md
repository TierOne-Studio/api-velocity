# Default Role Decoupling Plan

This plan replaces hardcoded dependence on seeded `admin` / `manager` / `member` organization roles so those defaults can be renamed, edited, and deleted safely without regressions.

It is based on validation against the current implementation in this repository, not against an older architecture snapshot.

## Confirmed product decisions

- Default seeded roles must be fully editable, including role name.
- Default seeded roles must be deletable.
- If a default role is deleted, the action must be blocked until all assignments are reassigned.
- The system must treat those three roles as initial defaults only, not permanent protected anchors.
- `superadmin` remains a distinct platform role.

## Architecture decisions (locked)

### Q1 — Org-lockout invariant: capability-based via new permission

Add `organization:manage-members` as a new permission.
- The lockout guard becomes: block any operation that would leave zero active members in the org holding this permission.
- Enforced at: role delete, member demote/remove, and role permission reassignment.
- `seedDefaultRoles()` must assign this permission to the org `admin` role on creation.
- Migration needed: insert the permission row and backfill it to all existing org admin roles.
- Do NOT protect any literal role name — only protect the capability.

### Q2 — `user.role` becomes platform-only

`user.role` must only ever hold `superadmin` or `null`.
- All org-scoped role identity lives exclusively in `member.role`.
- The rename cascade in `TypeOrmRoleRepository.update()` must stop touching `user.role` entirely.
- All code paths that read `user.role` to determine org-level access must be refactored to join through `member`.
- Better Auth session tokens must stop embedding org role from `user.role`; the session must derive org role from the active org's `member` row.
- SPA `AuthContext` role normalization must be replaced with org-context-aware logic.

### Q3 — `isSystem` renamed to `isDefault`, informational only

- Rename the column in a migration: `is_system` → `is_default`.
- Update the TypeORM entity and all references.
- Semantics: `isDefault = true` means "this role was seeded as a starter default."
- No business logic may gate on `isDefault`. It is a UI hint only.
- `seedDefaultRoles()` sets `isDefault = true` for new org starter roles.
- Custom roles always get `isDefault = false`.

### Q4 — No API version bump; coordinate SPA update in the same release

- Role DTOs move from literal unions (`'admin' | 'manager' | 'member'`) to `string`.
- The SPA TypeScript types must be updated in the same release to accept `string`.
- Role dropdowns and assignment UIs must source their options from the backend API, not hardcoded arrays.
- No `/v2` routing required; existing valid role name values continue to work.

## Validation summary against current implementation

### Confirmed blockers

- Dynamic org-role names are still blocked at the schema layer.
  - `src/shared/infrastructure/database/database.module.ts`
    - Adds `CHECK (role IN ('admin', 'manager', 'member'))` constraints on `member.role` and `invitation.role`.
  - This means role rename to arbitrary names cannot work end-to-end yet, even though some service/repository code already attempts to propagate renames.
- New organizations still auto-seed hardcoded `admin` / `manager` / `member` org roles.
  - `src/modules/admin/organizations/infrastructure/persistence/repositories/admin-org.database-repository.ts`
    - `seedDefaultRoles()` inserts those literal names and assigns hardcoded default permissions during org creation.
- Role metadata and permission checks are not consistently organization-scoped.
  - `src/modules/admin/organizations/infrastructure/persistence/repositories/admin-org.database-repository.ts`
    - `getRoles()` selects from all rows in `roles` globally.
  - `src/modules/admin/users/infrastructure/persistence/repositories/admin-user.database-repository.ts`
    - `listRoles()` also selects all roles globally.
  - `src/modules/admin/rbac/infrastructure/persistence/repositories/role.typeorm-repository.ts`
    - `hasPermission()` checks by `r.name` only, ignoring `organization_id`.

### Already partially implemented

- Organization-scoped role rename/delete support already exists in the active RBAC layer.
  - `src/modules/admin/rbac/application/services/role.service.ts`
    - Allows rename/delete for organization-scoped roles.
    - Blocks rename/delete for global roles.
    - Blocks delete while the role is still assigned.
  - `src/modules/admin/rbac/infrastructure/persistence/repositories/role.typeorm-repository.ts`
    - Transactionally propagates role renames to `member`, `invitation`, and some `user.role` rows.
- Because of this, the problem is not that rename/delete is entirely absent.
  - The real issue is that current support is incomplete and still conflicts with other hardcoded assumptions.

### Confirmed live dependencies

- `src/permissions.ts` is live, not dead code.
  - `src/auth.ts`
    - Better Auth `admin({ ac, roles, defaultRole: 'member' })` imports and uses the role definitions from `src/permissions.ts`.
- There are two hardcoded role helper files that both need to be decoupled.
  - `src/modules/admin/users/utils/admin.utils.ts`
  - `src/modules/admin/utils/admin.utils.ts`

### Repo-scope note

- The frontend paths listed in the earlier draft of this plan are not present in this repository workspace.
- Backend validation in this document is concrete.
- Frontend validation should be treated as pending unless done against the SPA repository/worktree that contains those files.

## Current coupling audit

### 1. Schema and migration coupling

- `src/shared/infrastructure/database/database.module.ts`
  - Enforces `member.role` and `invitation.role` to `admin|manager|member`.
  - This is the first hard blocker for arbitrary dynamic org-role names.
- `src/shared/infrastructure/database/migrations/001_initial_schema.sql`
  - Seeds `user.role`, `member.role`, and `invitation.role` with defaults tied to `member`.
  - Seeds literal `admin|manager|member` roles and permissions.
- `src/modules/admin/rbac/rbac.migration.ts`
  - Earlier migrations seed literal global roles by name.
  - `assignAllPermissionsToAdmin()` still looks up literal global `admin`.
  - `redesignSuperadminAndOrganizationRoles()` recreates per-org default `admin|manager|member` roles for every organization.
  - Bootstrap behavior is still name-coupled and can resurrect defaults.

### 2. Role helper and session-role coupling

- `src/modules/admin/users/utils/admin.utils.ts`
  - `OrganizationRoleName` and `PlatformRole` are tied to `admin|manager|member`.
  - `getPlatformRole()` collapses unknown roles to `member`.
  - `getAllowedRoleNamesForCreator()` is fully hardcoded.
- `src/modules/admin/utils/admin.utils.ts`
  - Duplicates the same hardcoded role assumptions for other admin modules.
- `src/auth.ts`
  - Better Auth still defaults new users to literal `member`.
- `src/permissions.ts`
  - Defines Better Auth access-control roles keyed to `superadmin|admin|manager|member`.
  - This file is authoritative for auth plugin behavior today.

### 3. User-management coupling

- `src/modules/admin/users/application/services/admin.service.ts`
  - `CreateUserInput.role` and `setUserRole()` accept only `admin|manager|member`.
  - `getTargetRole()` collapses any unknown role to `member`.
  - Non-superadmin target mutation logic is tied to `targetRole === 'member'`.
  - `getCreateUserMetadata()` exposes `allowedRoleNames` from hardcoded helper logic.
  - `getUserCapabilities()` and batch capabilities depend on name-derived target classification.
- `src/modules/admin/users/api/controllers/admin-users.controller.ts`
  - Create/set-role payload validation hardcodes literal allowed roles.
  - Create validation also assumes `admin` is the only special case for org assignment.
- `src/modules/admin/users/infrastructure/persistence/repositories/admin-user.database-repository.ts`
  - `setUserRole()` treats `role === 'admin'` specially by deleting all memberships.
  - `listRoles()` reads every role globally, not the target org role set.

### 4. Organization-management coupling

- `src/modules/admin/organizations/application/services/admin-organizations.service.ts`
  - `ROLE_HIERARCHY`, `getRoleLevel()`, and `filterAssignableRoles()` hardcode `member < manager < admin < superadmin`.
  - `create()` auto-assigns the org creator literal member role `admin`.
  - `createInvitation()` accepts only literal org role names via hardcoded helper logic.
  - `updateMemberRole()` and `removeMember()` treat `admin` specially.
  - Last-admin protection is literally `countAdmins()` based.
- `src/modules/admin/organizations/api/controllers/admin-organizations.controller.ts`
  - Payload validation for add member, invite member, and update member role only accepts `admin|manager|member`.
- `src/modules/admin/organizations/application/services/org-impersonation.service.ts`
  - Superadmin/admin logic and org-scoped impersonation logic still use literal role names.
  - Non-superadmin impersonation is tied to `target.role === 'member'`.
- `src/modules/admin/organizations/infrastructure/persistence/repositories/admin-org.database-repository.ts`
  - `seedDefaultRoles()` hardcodes default role names and permission assignment by literal role name.
  - `countAdmins()` assumes the privileged org-management role is named `admin`.
  - `getRoles()` is global, not filtered to a specific organization.

### 5. Guards and permission-resolution coupling

- `src/shared/guards/permissions.guard.ts`
  - Resolves permissions using `getPlatformRole(session)` and current active org.
  - This is compatible only if `getPlatformRole()` remains hardcoded and if org roles are still projected through that model.
- `src/modules/admin/rbac/application/services/role.service.ts`
  - `getUserPermissions()` is org-aware, but only if the caller passes the correct org-scoped role name.
- `src/modules/admin/rbac/infrastructure/persistence/repositories/role.typeorm-repository.ts`
  - `findAll()` is org-scoped only when the caller provides an `activeOrganizationId`.
  - `findByName()` is global.
  - `hasPermission()` is not org-scoped.
- `src/modules/admin/rbac/api/controllers/rbac.controller.ts`
  - Role listing is org-scoped for non-superadmins, but some downstream helpers are still mixed global/org behavior.
  - `getUserPermissions(roleName)` depends on active org context, while `checkPermission(roleName, resource, action)` currently ignores org scope.

## Target behavior

- `superadmin` remains the only global special-case role.
- Organization-scoped roles are data-driven records identified by persisted DB state, not by reserved names.
- Seeded defaults are starter roles only.
- Seeded defaults can be renamed and edited the same as custom roles.
- Seeded defaults can be deleted once all references are cleared.
- The system prevents org lockout by enforcing capability-based invariants, not by protecting literal role names.
- Bootstrap and org-creation flows never recreate deleted/renamed defaults unless the product explicitly asks to initialize defaults for a brand new organization.

## Required implementation strategy

### Phase 0. Remove hard schema blockers first

This phase must happen before attempting arbitrary rename support.

- Remove or replace the `member.role` and `invitation.role` check constraints that enforce `admin|manager|member`.
- Restrict `user.role` to platform identity only.
  - Valid values: `superadmin` or `null`. Nothing else.
  - Backfill: set `user.role = null` for all users whose current `user.role` is `admin|manager|member`.
  - Add a new check constraint: `user.role IN ('superadmin') OR user.role IS NULL`.
  - Remove the cascade that writes org-role values to `user.role` from `TypeOrmRoleRepository.update()`.
- Rename `is_system` column to `is_default` on the `roles` table.
  - Update the TypeORM entity (`RoleTypeOrmEntity`) and all references.
- Add/adjust migrations so upgraded databases and fresh databases converge on the same dynamic-role model.

### Phase 1. Separate bootstrap defaults from permanent role identity

- Refactor `src/modules/admin/rbac/rbac.migration.ts` so default org roles are treated as initial templates only.
- Refactor `src/modules/admin/organizations/infrastructure/persistence/repositories/admin-org.database-repository.ts`
  - `seedDefaultRoles()` must become a true initial-default routine, not a permanent name-enforcement routine.
  - `seedDefaultRoles()` must set `isDefault = true` for the three starter roles.
  - `seedDefaultRoles()` must assign `organization:manage-members` to the org admin role (see Q1 decision).
- Remove all permission assignment logic that depends on `name = 'admin'`, `name = 'manager'`, or `name = 'member'`.
- Add `organization:manage-members` permission to the permissions seed.
- Decouple Better Auth partially here: remove `defaultRole: 'member'` from `src/auth.ts` and replace with a lookup against the org's configured default role or a null assignment pending first login.
  - Reason: if `member` is renamed or deleted before Phase 6, user registration and invitation acceptance break silently.

### Phase 2. Define a data-driven org-role model

- Distinguish clearly between:
  - `isSuperadmin`
  - platform/global auth role
  - active organization membership role
  - role capabilities from `role_permissions`
- Stop using literal unions for organization role names in service/controller contracts.
- Decide the management model:
  - preferred: capability-based decisions derived from permissions
  - fallback if needed: persisted org-role metadata such as rank or management class
- Ensure any comparison logic is based on persisted capabilities/metadata, not lexical or hardcoded role names.

### Phase 3. Fix org scoping for role metadata and permission resolution

- Make role list/metadata endpoints explicitly organization-scoped.
  - `AdminOrganizationsService.getRoles()`
  - `AdminUserDatabaseRepository.listRoles()`
  - `AdminOrgDatabaseRepository.getRoles()`
- Make permission checks organization-scoped wherever org roles are involved.
  - `TypeOrmRoleRepository.hasPermission()` must include `organization_id` when appropriate.
- Eliminate cross-org collisions for same-named custom roles.
- Ensure APIs never mix global role rows and org role rows accidentally in role dropdowns or capability responses.

### Phase 4. Remove name-coupled backend policy

Refactor these backend areas after schema/scoping hardening:

- `src/modules/admin/users/utils/admin.utils.ts`
- `src/modules/admin/utils/admin.utils.ts`
  - remove org-role literal unions
  - keep only `superadmin` as a platform special case
  - replace `getAllowedRoleNamesForCreator()` with a DB-driven resolver that fetches assignable roles from the target org
- `AdminService`
  - widen role inputs from literal unions to `string`
  - replace `getTargetRole()` / `targetRole === 'member'` checks with capability-based checks (does the target role have `organization:manage-members`?)
  - derive assignable roles from the active org's role list
- `AdminOrganizationsService`
  - replace `ROLE_HIERARCHY` / `filterAssignableRoles()` with DB-driven logic using org role list
  - replace `countAdmins()` last-admin check with: count active members whose role has the `organization:manage-members` permission in this org
  - `create()` assigns the org creator to the org `admin` role by ID, not by literal name
- `OrgImpersonationService`
  - replace literal `admin`/`member` checks with permission-based rules (`organization:manage-members` for privileged actor, absence of it for restricted target)
- controllers / DTOs / repository interfaces / tests
  - widen hardcoded role unions to `string`
  - validate role inputs against existing roles in the target organization, not literals
- SPA coordinated update (same release)
  - replace `'admin' | 'manager' | 'member'` type unions with `string` across all service types and component props
  - replace `ROLE_HIERARCHY` constant in `role-hierarchy.ts` with a DB-driven rank or capability lookup
  - replace hardcoded role arrays in dropdowns with data fetched from the backend roles API
  - replace `AuthContext` role normalization priority list with org-context-aware logic reading `member.role` from the active org session
  - expose `isSuperadmin: boolean` as an explicit field from the session API; remove `user?.role === 'superadmin'` comparisons in the SPA

### Phase 5. Make rename and delete safe at the data layer

- Keep role rename transactional.
- Update all persisted references when a role name changes.
  - `member.role`
  - `invitation.role`
  - `user.role` is NOT touched — it is now platform-only and contains no org role values.
- Wrap `getUsageSummary()` + `remove()` in a single serializable transaction with a row lock on the role to eliminate the race condition between usage check and delete.
- Block delete while the role is still referenced anywhere (users, members, invitations).
- Block delete if removing this role would leave zero members in the org with the `organization:manage-members` permission.
- Return explicit business errors for:
  - role still assigned
  - org lockout invariant violation (last `organization:manage-members` holder)
- Delete restrictions are reference- and capability-based only. `isDefault` is never a delete guard.

### Phase 6. Decouple auth/plugin assumptions

- Rework `src/permissions.ts` and `src/auth.ts` so Better Auth integration no longer reintroduces hardcoded org-role semantics.
- Preserve `superadmin` as the only stable global role anchor if that remains the product decision.
- Ensure session parsing does not collapse unknown org roles to `member`.

## Public API impact

Expected API contract changes:

- Role-related DTOs and payloads move from literal role unions to dynamic strings.
- Role metadata endpoints become organization-scoped and return assignable roles dynamically.
- Business errors become more specific for:
  - role still assigned
  - role not valid in target organization
  - org lockout invariant violations
- Capability responses should expose capability-derived state rather than name-derived state.

## Test strategy

### Backend unit/integration focus

- Schema no longer rejects renamed/custom org-role values.
- `user.role` accepts only `superadmin` or `null` — backfill and constraint enforced.
- Role rename updates `member.role` and `invitation.role` transactionally; `user.role` is not touched.
- Role delete is blocked while assigned (users, members, invitations).
- Role delete is blocked if it would remove the last holder of `organization:manage-members` in the org.
- Role delete succeeds once unassigned and org lockout invariant is satisfied.
- Actor-to-target mutation rules work for renamed defaults and custom roles equally.
- Org invitation/member-role assignment accepts dynamic org roles.
- Org creation seeds `isDefault = true` starter roles and assigns `organization:manage-members` to the admin role.
- Startup/bootstrap does not recreate deleted/renamed defaults unexpectedly.
- Permission checks are organization-scoped when role names overlap across organizations.
- `isDefault` flag is never used as a delete or rename guard.

### Migration/regression focus

- Fresh database setup and upgraded databases land on the same dynamic-role behavior.
- Existing databases with current `CHECK` constraints are migrated safely.
- Existing organizations with seeded defaults continue to function after decoupling.

### Frontend regression focus

Run these only in the repository/worktree that contains the SPA:

- Seeded roles show edit/delete when permitted.
- Renamed default roles still work in user-management and org-member-management flows.
- Dropdowns source role options from the backend API, not hardcoded arrays.
- No UI logic breaks when `admin`, `manager`, or `member` no longer exist literally.
- `isSuperadmin` flag from the session API drives superadmin UI logic; no `role === 'superadmin'` comparisons remain.
- `AuthContext` role normalization reads `member.role` from the active org session context, not from a hardcoded priority list.
- TypeScript role union types replaced with `string` across service types, component props, and test fixtures.

## High-risk areas to verify explicitly

- schema constraints on `member.role` and `invitation.role`
- org creation default-role seeding
- startup migrations / seed replay
- session/auth role normalization
- permission checks for same-named custom roles in different organizations
- user creation and role reassignment flows
- organization member management and invitations
- impersonation behavior
- any remaining tests/helpers still using literal unions

## Recommended execution order

1. Add failing integration tests for schema, role rename/delete, org creation seeding, and org-scoped permission checks.
2. Remove schema constraints that force `admin|manager|member`.
3. Fix org scoping for role metadata and permission checks.
4. Refactor bootstrap and org-creation seeding so defaults are initialization-only.
5. Replace name-coupled backend policy with capability-/metadata-driven logic.
6. Decouple Better Auth role/session assumptions.
7. Run focused regression across users, organizations, invitations, impersonation, and startup behavior.
8. Validate the SPA separately in the frontend repository/worktree.

## Acceptance criteria

- Seeded default org roles can be renamed, edited, and deleted like custom roles.
- Delete is blocked until all references (users, members, invitations) are cleared.
- Delete is blocked if it would leave zero members in the org with `organization:manage-members`.
- No database constraint restricts org roles to literal `admin|manager|member`.
- No backend logic requires literal org-role names for authorization or management decisions.
- `user.role` holds only `superadmin` or `null`; no org-role values are written to it.
- Org role is always resolved from `member.role` in the context of the active organization.
- `is_default` column (renamed from `is_system`) is informational only and never gates business logic.
- New organization creation seeds `isDefault = true` starter roles with `organization:manage-members` on the admin role.
- Restart/bootstrap does not recreate deleted or renamed defaults unexpectedly.
- Same-named custom roles in different organizations do not leak or collide.
- `superadmin` behavior remains unchanged.
- SPA type unions are widened to `string`; all role dropdowns and assignments use dynamic backend data.
- SPA `isSuperadmin` is sourced from the session API flag, not inferred from a role name string.
