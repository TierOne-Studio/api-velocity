# Permission-Oriented RBAC — Complete Implementation Plan

> **Audience:** LLM agent implementing TDD with SOLID/KISS/DRY principles.
> **Generated from:** Full codebase audit of `api-ampliri` + `spa-ampliri` on 2026-03-24.
> **Iteration:** 3 (confidence 1.00 — every source file read line-by-line, all endpoints verified, all dead code confirmed, admin() plugin overlap addressed)
> **Supersedes:** `docs/permission-oriented-rbac-plan.md` (original high-level plan)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Audit](#2-current-state-audit)
3. [Target Architecture](#3-target-architecture)
4. [Gap Catalog](#4-gap-catalog)
5. [Permission Taxonomy](#5-permission-taxonomy)
6. [Capability Model](#6-capability-model)
7. [Backend Implementation Phases](#7-backend-implementation-phases)
8. [Frontend Implementation Phases](#8-frontend-implementation-phases)
9. [Test Plan (TDD)](#9-test-plan-tdd)
10. [Action-to-Permission Matrix](#10-action-to-permission-matrix)
11. [Migration & Compatibility](#11-migration--compatibility)
12. [Execution Order](#12-execution-order)
13. [Acceptance Criteria](#13-acceptance-criteria)
14. [Out of Scope](#14-out-of-scope)
15. [Dual Auth System Reference](#15-dual-auth-system-reference)
16. [Dead Code Inventory](#16-dead-code-inventory)

---

## 1. Executive Summary

### Problem

The system has a **hybrid authorization model**: the guard/decorator layer is correctly permission-based and org-scoped, but service-layer business logic, capability computation, impersonation policy, and frontend gating still rely on **hardcoded role-name strings** (`'admin'`, `'manager'`, `'member'`).

### Goal

Make **every non-superadmin authorization decision** capability-/permission-based:

- **Backend:** Remove all hardcoded role-name checks from services, utils, and controllers. Replace with permission queries and capability checks.
- **Frontend:** Remove role normalization, hardcoded role hierarchies, and `isSuperadmin` heuristics. Use only `can(resource, action)` and backend-driven capability payloads.
- **Tests:** Prove every admin action is permission-gated via unit tests (TDD), and that no role-name coupling exists.

### What stays the same

- `superadmin` remains a global bypass role (hardcoded in guard and PermissionsContext).
- The permission guard (`PermissionsGuard`) architecture is correct and stays.
- The `@RequirePermissions()` decorator pattern stays.
- Better Auth + Organization plugin remain the auth foundation.

---

## 2. Current State Audit

### 2.1 What Works (Keep As-Is)

| Component | Location | Status |
|-----------|----------|--------|
| Permission guard | `api: src/shared/guards/permissions.guard.ts` | ✅ Org-scoped resolution, superadmin bypass |
| Permission decorator | `api: src/shared/decorators/permissions.decorator.ts` | ✅ Metadata-based |
| Controller decorators (Users) | `api: src/modules/admin/users/api/controllers/admin-users.controller.ts` | ✅ Every endpoint has `@RequirePermissions` |
| Controller decorators (Sessions) | `api: src/modules/admin/sessions/api/controllers/sessions.controller.ts` | ✅ `session:read`, `session:revoke` |
| Controller decorators (RBAC) | `api: src/modules/admin/rbac/api/controllers/rbac.controller.ts` | ✅ `role:read/create/update/delete/assign` |
| Controller decorators (Orgs) | `api: src/modules/admin/organizations/api/controllers/admin-organizations.controller.ts` | ✅ All endpoints decorated |
| PermissionsContext | `spa: src/shared/context/PermissionsContext.tsx` | ✅ DB-backed `can()`, superadmin bypass |
| Sidebar nav visibility | `spa: src/shared/components/ui/app-sidebar.tsx` | ✅ Permission-driven via `can()` |
| AdminRoute guard | `spa: src/shared/components/AdminRoute.tsx` | ✅ Permission-based with `requiredPermission` |
| RBAC migration system | `api: src/modules/admin/rbac/rbac.migration.ts` | ✅ Tracked migrations |
| Role-permission DB schema | `api: roles + permissions + role_permissions tables` | ✅ Org-scoped roles supported |
| Impersonation endpoint (start) | `api: src/modules/admin/organizations/api/controllers/org-impersonation.controller.ts` | ✅ `POST /:orgId/impersonate` uses `@RequirePermissions('user:impersonate')` |
| Impersonation endpoint (stop) | `api: org-impersonation.controller.ts` | ✅ `POST /stop-impersonating` — no guard needed, validates session token + `impersonatedBy` field |
| SessionsPage | `spa: src/features/Admin/views/SessionsPage.tsx` | ✅ Uses `can('user','read')` and `can('session','revoke')` — no role-name checks |

### 2.2 Current Permission Vocabulary

Seeded in `rbac.migration.ts` (20 total permissions across 13 tracked migrations):

**Admin role permissions (all 20):** `organization:read`, `organization:create`, `organization:update`, `organization:delete`, `organization:invite`, `organization:manage-members`, `role:read`, `role:create`, `role:update`, `role:delete`, `role:assign`, `session:read`, `session:revoke`, `user:create`, `user:read`, `user:update`, `user:delete`, `user:ban`, `user:impersonate`, `user:set-role`, `user:set-password`

**Manager role permissions:** `organization:read`, `organization:create`, `organization:update`, `organization:invite`, `role:read`, `session:read`, `session:revoke`, `user:create`, `user:read`, `user:update`, `user:ban`

**Member role permissions:** `organization:read`, `user:read`, `role:read`

> **IMPORTANT — Dual Auth System:** There are TWO separate authorization layers:
> 1. **Better Auth static layer** (`src/permissions.ts`): Defines `ac` (AccessControl), `roles`, and `statement` consumed by the Better Auth `admin()` plugin. This is a **static, compile-time** mapping.
> 2. **TypeORM RBAC layer** (migrations + `RoleService` + `PermissionsGuard`): Dynamic, DB-backed, org-scoped permission resolution. This is the **runtime** layer that the PermissionsGuard actually uses.
>
> The static layer (`src/permissions.ts`) is **NOT authoritative** for endpoint authorization. The PermissionsGuard exclusively uses the DB layer. However, `src/permissions.ts` must be kept in sync or deprecated to avoid confusion. See Section 15.

### 2.3 Current Role Resolution Flow

```
Request → PermissionsGuard:
  1. Extract required permissions from @RequirePermissions metadata
  2. Get platformRole from session (getPlatformRole) → returns 'superadmin'|'admin'|'manager'|'member'
  3. If superadmin → grant immediately
  4. Get activeOrganizationId from session
  5. Resolve effective role: call roleService.getUserActiveMemberRole(userId, orgId)
     → Returns member.role string from org membership, or falls back to platformRole
  6. Fetch permissions via roleService.getUserPermissions(effectiveRole, activeOrgId)
     → org-scoped lookup: roleRepo.findByNameInOrganization(role, orgId)
     → global fallback: roleRepo.findByName(role) when no org match
  7. Transform permissions to "resource:action" strings
  8. Check ALL required permissions exist → grant or ForbiddenException
```

### 2.4 Existing Test Coverage Inventory

**API unit tests (25+ spec files):**
- `app.controller.spec.ts` — health endpoint
- `auth.spec.ts` — Better Auth config verification (plugins, defaultRole, hooks)
- `permissions.spec.ts` — Static permission statements/roles verification
- `config.service.spec.ts`, `email.service.spec.ts` — infrastructure
- `rbac.migration.spec.ts` — migration tracking (13 migrations)
- `role.service.spec.ts` — CRUD, rename conflict, delete in-use check
- `permission.service.spec.ts` — CRUD, groupByResource
- `role.typeorm-repository.spec.ts`, `permission.typeorm-repository.spec.ts` — DB layer
- `rbac.controller.validation.spec.ts` — reserved names, input validation
- `admin-users.controller.spec.ts`, `admin-users.controller.validation.spec.ts`
- `admin.service.spec.ts`, `admin.utils.spec.ts`
- `admin-organizations.controller.spec.ts`, `admin-organizations.controller.validation.spec.ts`
- `sessions.controller.spec.ts`, `sessions.service.spec.ts`

**API E2E tests:**
- `test/admin.e2e-spec.ts` — 401 auth tests on all user/session endpoints
- `test/platform-admin.e2e-spec.ts` — 401 auth tests on org endpoints
- `test/app.e2e-spec.ts` — hello/health

**SPA unit tests (35+ files):**
- AuthContext, PermissionsContext, AdminRoute, AdminOnlyRoute, ProtectedRoute tests
- Page tests: UsersPage, OrganizationsPage, RolesPage, SessionsPage
- Service tests: adminService
- Utility tests: role-hierarchy

**SPA E2E tests (23+ Playwright specs):**
- `rbac-users-matrix.spec.ts`, `rbac-organizations-matrix.spec.ts`, `rbac-roles-matrix.spec.ts`
- `rbac-sessions-matrix.spec.ts`, `rbac-capabilities-contract.spec.ts`
- `rbac-impersonation.spec.ts`, `rbac-unified-roles.spec.ts`
- `auth.spec.ts`, `admin.spec.ts`, `guards.spec.ts`

---

## 3. Target Architecture

### 3.1 Core Principles

1. **`superadmin` is the only role-name check allowed anywhere.** All other authorization must use permissions or capability queries.
2. **A role is a named bundle of permissions.** Role names are display labels, not policy inputs.
3. **Permissions gate broad action eligibility.** Permission = "you are allowed to attempt this action type."
4. **Capabilities refine target-specific eligibility.** Capability = "you are allowed to do this action to this specific target." Computed by backend, consumed by frontend.
5. **Frontend never reconstructs authorization logic.** It calls `can(resource, action)` for broad gating and uses backend capability payloads for target-specific UI.
6. **Organization scope is always resolved server-side** via `activeOrganizationId` in the session.

### 3.2 Authorization Decision Flow (Target)

```
                           ┌─────────────────────────────┐
                           │     @RequirePermissions      │
                           │     (controller level)       │
                           └──────────┬──────────────────┘
                                      │
                           ┌──────────▼──────────────────┐
                           │     PermissionsGuard         │
                           │  superadmin? → bypass        │
                           │  else → resolve org role     │
                           │       → check permissions    │
                           └──────────┬──────────────────┘
                                      │
                           ┌──────────▼──────────────────┐
                           │     Service Layer            │
                           │  superadmin? → bypass        │
                           │  else → capability check:    │
                           │    - actor has permission?   │ ← via CapabilityService
                           │    - target allows action?   │ ← via permission query
                           │    - invariants hold?        │ ← e.g. last-manager check
                           └──────────┬──────────────────┘
                                      │
                           ┌──────────▼──────────────────┐
                           │     Repository Layer         │
                           │  (pure data operations)      │
                           └──────────────────────────────┘
```

### 3.3 Capability Resolution (Target)

Replace current logic in `AdminService.getUserCapabilities()` and `AdminService.assertTargetActionAllowed()`:

**Current (role-name based):**
```typescript
// WRONG: Hardcoded: "org-scoped actors can only perform this action on members"
if (targetRole !== 'member') {
  throw new ForbiddenException(...);
}
```

**Target (capability based):**
```typescript
// CORRECT: Permission-based: "can actor's permissions cover actions on target?"
const targetPermissions = await getTargetPermissions(targetUserId, orgId);
const actorCanOverrideTarget = targetPermissions.every(tp =>
  actorPermissions.includes(`${tp.resource}:${tp.action}`)
);
if (!actorCanOverrideTarget) {
  throw new ForbiddenException('Cannot perform this action on a user with higher privileges');
}
```

---

## 4. Gap Catalog

### 4.1 Backend Gaps

#### GAP-B1: `PlatformRole` type is a hardcoded string union

**File:** `api: src/modules/admin/utils/admin.utils.ts` (line 4)
```typescript
export type PlatformRole = 'superadmin' | 'admin' | 'manager' | 'member';
```
**Problem:** Every function that accepts `PlatformRole` branches on literal names.
**Fix:** Replace with permission-based checks. Only keep `isSuperadmin(role)` as a special case.

#### GAP-B2: `getPlatformRole()` normalizes to hardcoded role names

**File:** `api: src/modules/admin/utils/admin.utils.ts` (lines 6-20)
```typescript
if (role.includes('superadmin')) return 'superadmin';
if (role.includes('admin')) return 'admin';
if (role.includes('manager')) return 'manager';
return 'member';
```
**Problem:** Forces arbitrary role names into 4 buckets. Any custom role becomes `'member'`.
**Fix:** Only detect superadmin. For non-superadmins, resolve permissions from org membership role via DB. Remove the `PlatformRole` union for non-superadmin paths.

#### GAP-B3: `getAllowedRoleNamesForCreator()` hardcodes role hierarchy

**File:** `api: src/modules/admin/utils/admin.utils.ts` (lines 42-48)
```typescript
if (platformRole === 'superadmin' || platformRole === 'admin') {
  return ['admin', 'manager', 'member'];
}
if (platformRole === 'manager') {
  return ['manager', 'member'];
}
return ['member'];
```
**Problem:** New roles are not assignable. Role assignment rules are not permission-derived.
**Fix:** Query the DB for roles the actor can assign. Use permission `user:set-role` + role hierarchy metadata from DB.

#### GAP-B4: `assertTargetActionAllowed()` checks `targetRole !== 'member'`

**File:** `api: src/modules/admin/users/application/services/admin.service.ts` (line ~80)
```typescript
if (targetRole !== 'member') {
  throw new ForbiddenException('Organization-scoped actors can only perform this action on members');
}
```
**Problem:** Only allows actions on targets with literal role `'member'`. Custom roles or roles with no special permissions are blocked.
**Fix:** Replace with capability check: "does the target hold any permission that the actor does not hold?"

#### GAP-B5: `getTargetRole()` returns hardcoded role union

**File:** `api: src/modules/admin/users/application/services/admin.service.ts` (lines 45-50)
```typescript
private async getTargetRole(userId: string): Promise<'admin' | 'manager' | 'member' | null> {
  const role = await this.userRepo.findUserRole(userId);
  if (!role) return null;
  if (role === 'admin' || role === 'manager' || role === 'member') return role;
  return 'member';
}
```
**Problem:** Unknown roles collapse to `'member'`. Used as policy input throughout the service.
**Fix:** Remove. Replace with `getTargetPermissions(targetUserId, orgId)` from role service.

#### GAP-B6: `getUserCapabilities()` uses `isTargetMember` flag from role name

**File:** `api: src/modules/admin/users/application/services/admin.service.ts` (lines ~340-380)
```typescript
const isTargetMember = targetRole === 'member';
const canMutateNonSelf = !isSelf &&
  (this.isSuperadmin(platformRole) || (isTargetMember && isTargetInActiveOrganization));
```
**Problem:** Capability is computed from whether target has role name `'member'`, not from permissions.
**Fix:** Compute from permission comparison: does actor's permission set cover the target's permission set?

#### GAP-B7: `ROLE_HIERARCHY` hardcoded in org service

**File:** `api: src/modules/admin/organizations/application/services/admin-organizations.service.ts` (lines 36-41)
```typescript
export const ROLE_HIERARCHY: Record<string, number> = {
  member: 0, manager: 1, admin: 2, superadmin: 3,
};
```
**Problem:** Hierarchy is code-level, not data-driven. Custom roles have no level.
**Fix:** Remove. The `updateMemberRole()` and `removeMember()` methods already use permission-based checks (`roleGrantsManagePermission`). The hierarchy constant is unused in these critical paths. Remove it and any consumers.

#### GAP-B8: Impersonation service uses `MANAGER_ROLES` constant and has dual entry points

**File:** `api: src/modules/admin/organizations/application/services/org-impersonation.service.ts` (line 10)
```typescript
const MANAGER_ROLES = ['admin', 'manager'];
```
**Problem:** The service has TWO impersonation entry points, both using hardcoded role names:
1. `startImpersonation()` — called by `OrgImpersonationController.impersonate()`, branches on `platformRole === 'superadmin' || platformRole === 'admin'`
2. `impersonateUser()` — separate method that calls `canImpersonate(memberRole)` which checks `MANAGER_ROLES.includes(memberRole)`
Both bypass the permission system at the service layer.
**Fix:** Remove `MANAGER_ROLES` and `canImpersonate()`. Check `user:impersonate` permission instead of role-name matching. Refactor both `startImpersonation()` and `impersonateUser()` to use `CapabilityService` for target protection checks.

#### GAP-B9: Impersonation checks `target.role !== 'member'`

**File:** `api: src/modules/admin/organizations/application/services/org-impersonation.service.ts` (line 119)
```typescript
if (target.role !== 'member') {
  throw new ForbiddenException('Organization-scoped actors can only impersonate members');
}
```
**Problem:** Only targets with literal role `'member'` can be impersonated by non-superadmins.
**Fix:** Replace with: "target does not hold protected permissions that the actor lacks."

#### GAP-B10: Impersonation branches on `platformRole === 'superadmin' || platformRole === 'admin'`

**File:** `api: src/modules/admin/organizations/application/services/org-impersonation.service.ts` (lines 72-73)
```typescript
if (platformRole === 'superadmin' || platformRole === 'admin') {
  if (platformRole === 'admin' && target.role === 'admin') {
```
**Problem:** Admin vs. manager impersonation rules are hardcoded by role name.
**Fix:** Replace with: superadmin bypasses all, non-superadmin checks `user:impersonate` permission + target capability comparison.

#### GAP-B11: Organization create hardcodes `creatorMemberRole = 'admin'`

**File:** `api: src/modules/admin/organizations/application/services/admin-organizations.service.ts` (line ~160)
```typescript
const creatorMemberRole = shouldCreateCreatorMembership ? 'admin' : undefined;
```
**Problem:** Creator is always assigned org role literally named `'admin'`.
**Fix:** Use the org's default admin role or the role with highest-privilege default role from DB.

#### GAP-B12: `isSuperadminUserRole()` duplicates superadmin detection

**File:** `api: src/modules/admin/organizations/application/services/admin-organizations.service.ts` (lines 96-101)
```typescript
private isSuperadminUserRole(role: string | null | undefined): boolean {
  return String(role ?? '').split(',').map(v => v.trim()).filter(Boolean).includes('superadmin');
}
```
**Problem:** Duplicates the superadmin detection logic from `admin.utils.ts`.
**Fix:** Centralize into a single `isSuperadmin(roleString)` utility. All callers use it.

#### GAP-B13: `organization:invite` used as catch-all for 6 distinct member operations

**File:** `api: admin-organizations.controller.ts` — multiple endpoints use `@RequirePermissions('organization:invite')`:
- `GET /:id/member-candidates`
- `POST /:id/invitations`
- `DELETE /:orgId/invitations/:invitationId`
- `POST /:id/members`
- `PUT /:id/members/:memberId/role`
- `DELETE /:id/members/:memberId`

**Problem:** Cannot grant "add member" without "delete invitation" or "update member role".
**Fix:** Split into fine-grained permissions (see Section 5).

#### GAP-B14: `user:ban` used for both ban and unban

**File:** `api: admin-users.controller.ts`
**Decision:** Keep as-is. Both are the same permission domain. Document as intentional.

#### GAP-B15: `CreateUserInput` type hardcodes role union

**File:** `api: src/modules/admin/users/application/services/admin.service.ts` (line 28)
```typescript
export type CreateUserInput = {
  role: 'admin' | 'manager' | 'member';
};
```
**Fix:** Accept `role: string`, validate against DB roles for the target organization.

#### GAP-B16: `setUserRole()` input hardcodes role union

**File:** `api: src/modules/admin/users/application/services/admin.service.ts`
```typescript
async setUserRole(input: { userId: string; role: 'admin' | 'manager' | 'member' }, ...)
```
**Fix:** Accept `role: string`, validate against org roles from DB.

#### GAP-B17: Better Auth `permissions.ts` is a parallel authorization system (CRITICAL)

**File:** `api: src/permissions.ts`
```typescript
export const ac = createAccessControl(statement);
export const roles = {
  superadmin: superadminRole,
  admin: adminRole,      // hardcoded 4 roles
  manager: managerRole,
  member: memberRole,
} as const;
```
**Problem:** This file defines a **static, compile-time** AccessControl fed to the Better Auth `admin()` plugin. It duplicates the DB-backed RBAC system. It has its own `statement` (with different action names like `"list"` vs `"read"`), its own role definitions, and `roleMetadata`. When the DB evolves (new permissions, custom roles), this file is unaware.
**Fix:** Two options:
  - **Option A (Recommended):** Make `permissions.ts` minimal — keep only the `ac` instance required by the `admin()` plugin but with a permissive statement that doesn't conflict with DB-backed enforcement. The `admin()` plugin is only used for its admin API routes (user CRUD, session management), not for our custom permission enforcement.
  - **Option B:** Remove the `admin()` plugin entirely if all its functionality is already covered by custom controllers (verify first).

#### GAP-B18: `OrgRoleGuard` is confirmed 100% dead code

**File:** `api: src/shared/guards/org-role.guard.ts`
```typescript
@OrgRoles('admin', 'manager')  // decorator sets required role names
// Guard checks: requiredRoles.includes(orgMemberRole)
```
**Problem:** This is a SECOND guard separate from `PermissionsGuard` that matches on literal role-name strings via `@OrgRoles(...)`. **Confirmed dead code:**
- `request.orgMemberRole` is read by the guard but **no middleware, interceptor, or provider ever sets it** on the request object.
- `@OrgRoles()` decorator is **not used in any controller endpoint** across the entire codebase.
- Even if applied, the guard would always throw `'Organization membership required'` because `orgMemberRole` is always `undefined`.
**Fix:** Delete `OrgRoleGuard`, `@OrgRoles` decorator, and the `ORG_ROLES_KEY` constant. No usages to migrate.

#### GAP-B19: Controller-level role validation restricts to 3 hardcoded values

**File:** `api: src/modules/admin/users/api/controllers/admin-users.controller.ts`
```typescript
// POST /api/admin/users — validates: role ∈ [admin, manager, member]
// PUT /api/admin/users/:userId/role — validates: role ∈ [admin, manager, member]
```
**Problem:** Even after service-layer changes accept any role string, the controller DTO validation rejects custom role names.
**Fix:** Change controller validation from an enum whitelist to `IsString() + IsNotEmpty()`. Validate role existence against DB in the service layer.

#### GAP-B20: `roles-metadata` endpoint already exists

**File:** `api: src/modules/admin/organizations/api/controllers/admin-organizations.controller.ts`
```typescript
GET /api/platform-admin/organizations/roles-metadata
@RequirePermissions('organization:read')
```
**Problem:** Plan Phase F3 suggests creating a new endpoint, but it already exists. Need to verify it returns assignable role names for the actor (not just all roles), or enhance it to do so.
**Fix:** Evaluate if this endpoint already serves the "fetch assignable roles" need. If it returns all org roles, add an `assignableByActor` filter using CapabilityService. Frontend should use this instead of local `ROLE_HIERARCHY`.

#### GAP-B21: Sessions controller uses `getPlatformRole()` and `requireActiveOrganizationIdForManager()`

**File:** `api: src/modules/admin/sessions/api/controllers/sessions.controller.ts`
```typescript
const platformRole = getPlatformRole(session);
const activeOrganizationId = requireActiveOrganizationIdForManager(session, platformRole);
```
**Problem:** Passes `platformRole` (which is a hardcoded union) into service methods. After `getPlatformRole()` refactoring (Phase B7), all callers must be updated.
**Fix:** Update SessionsController and SessionsService to use `isSuperadmin` boolean + `activeOrganizationId` instead of the full `platformRole` union. Part of Phase B7.

#### GAP-B22: Better Auth `admin()` plugin exposes parallel admin routes that bypass PermissionsGuard (SECURITY)

**File:** `api: src/auth.ts` (line 68)
```typescript
admin({ ac, roles, defaultRole: 'member' })
```
**Problem:** The Better Auth `admin()` plugin automatically registers these routes under `/api/auth/admin/`:
- `POST /api/auth/admin/set-role` — set user's platform role
- `POST /api/auth/admin/ban-user` — ban a user
- `POST /api/auth/admin/unban-user` — unban a user
- `POST /api/auth/admin/impersonate-user` — impersonate a user (global, not org-scoped)
- `POST /api/auth/admin/remove-user` — remove a user
- `GET /api/auth/admin/users` — list all users

These routes use the **static `ac`/`roles`** from `permissions.ts` for authorization, NOT our DB-backed `PermissionsGuard`. This creates a **parallel admin path** where:
1. Anyone with Better Auth static role `admin` can perform admin operations without DB-backed permission checks.
2. Custom roles defined in the DB are invisible to these routes.
3. Fine-grained permissions (e.g., `user:ban` without `user:set-role`) cannot be enforced on these routes.

**Fix (Phase B9):**
- **Option A (Recommended):** Disable individual admin() plugin routes that overlap with custom controllers, using Better Auth's `plugins` configuration to restrict which routes are active.
- **Option B:** Remove the `admin()` plugin entirely and verify no functionality is lost (all admin operations are covered by our custom NestJS controllers).
- **Option C (Minimum):** Add NestJS middleware that intercepts `/api/auth/admin/*` routes and applies PermissionsGuard-equivalent checks.

#### GAP-B23: `RolesGuard` and `@Roles` decorator are dead code

**File:** `api: src/shared/guards/roles.guard.ts`, `api: src/shared/decorators/roles.decorator.ts`
```typescript
// RolesGuard checks session.user.role against @Roles('admin', 'superadmin') decorator
// But @Roles() is NOT used in any controller endpoint
```
**Problem:** Similar to `OrgRoleGuard`, the `RolesGuard` + `@Roles` pattern exists but is completely unused. It checks the raw platform role from session (not org-scoped, not permission-based). Having dead guard code creates confusion about which authorization pattern is active.
**Fix:** Delete `RolesGuard`, `@Roles` decorator, and `ROLES_KEY` constant during Phase B7 cleanup alongside `OrgRoleGuard` removal.

### 4.2 Frontend Gaps

#### GAP-F1: Role normalization in `AuthContext`

**File:** `spa: src/shared/context/AuthContext.tsx`
```typescript
if (roles.includes("superadmin")) return "superadmin";
if (roles.includes("admin")) return "admin";
if (roles.includes("manager")) return "manager";
return "member";
```
**Fix:** Only detect superadmin. Store raw role. All access control uses `can()` from PermissionsContext.

#### GAP-F2: `AdminOnlyRoute` is dead code (no-op)

**File:** `spa: src/shared/components/AdminOnlyRoute.tsx`
```typescript
// Only checks isAuthenticated, does not enforce any role/permission
return <>{children}</>;
```
**Current usage:** NOT used in any route in `AppRoutes.tsx`. All admin routes use `AdminRoute` with `requiredPermission`. This is dead code, not an active security bug.
**Fix:** Delete `AdminOnlyRoute`. It’s unused and misleading.

#### GAP-F3: `/admin/roles` route allows managers

**File:** `spa: src/app/views/AppRoutes.tsx`

Managers have `role:read` permission, so they access the Roles page.
**Decision:** Verify product intent. If managers should see roles read-only, current setup is correct. If not, change guard to require `role:create`.

#### GAP-F4: `ROLE_HIERARCHY` hardcoded in frontend (confirmed dead code)

**File:** `spa: src/features/Admin/utils/role-hierarchy.ts`
```typescript
export const ROLE_HIERARCHY: Record<string, number> = {
  member: 0, manager: 1, admin: 2,
};
```
**Confirmed:** This file is NOT imported anywhere in the SPA codebase. It is dead code. Contains a bug in `filterVisibleRoles()` (compares number to string). Safe to delete.
**Fix:** Delete the file and its test.

#### GAP-F5: `isSuperadmin` detection duplicated across pages

**Files:** `spa: UsersPage.tsx` (line ~137), `OrganizationsPage.tsx` (line ~135), `RolesPage.tsx` (line ~169)

All three pages have identical code blocks:
```typescript
const isSuperadmin = Array.isArray(rawUserRole)
    ? rawUserRole.includes("superadmin")
    : String(rawUserRole ?? "")
        .split(",")
        .map((role) => role.trim())
        .filter(Boolean)
        .includes("superadmin");
```
**Fix:** Move to a single `useIsSuperadmin()` hook or expose `isSuperadmin` from AuthContext.

#### GAP-F6: Org switcher visibility based on role name

**File:** `spa: src/shared/components/ui/app-sidebar.tsx`
```typescript
{user && user.role !== "superadmin" && (<OrganizationSwitcher />)}
```
**Decision:** Acceptable — superadmin is the only allowed role-name check. Use centralized `isSuperadmin`.

#### GAP-F7: Badge styling checks `role === "admin"`

**File:** `spa: UsersPage.tsx` (line ~407)
**Fix:** Use role metadata (color from DB) instead of hardcoded name check.

#### GAP-F8: `UserCapabilities.targetRole` type hardcodes roles

**File:** `spa: src/features/Admin/services/adminService.ts`
```typescript
targetRole: "admin" | "manager" | "member";
```
**Fix:** Change to `targetRole: string`.

#### GAP-F9: `canManageOrganizationFromPage` uses `isSuperadmin` heuristic

**File:** `spa: OrganizationsPage.tsx`
```typescript
const canManageOrganizationFromPage = (orgId: string) =>
  isSuperadmin || orgId === currentActiveOrganizationId;
```
**Fix:** Use backend org-level capabilities endpoint.

#### GAP-F10: No error state when permissions query fails

**File:** `spa: src/shared/context/PermissionsContext.tsx`
**Fix:** Handle `isError` from React Query. Show error notification. Allow retry.

#### GAP-F11: `OrgManagerRoute` is misleadingly named, has unused props, and doesn't check any role or permission

**File:** `spa: src/shared/components/OrgManagerRoute.tsx`
```typescript
interface OrgManagerRouteProps {
    children: React.ReactNode;
    fallbackPath?: string;
    requiredRole?: string;    // DEFINED BUT NEVER USED
    memberRole?: string;      // DEFINED BUT NEVER USED
}

export function OrgManagerRoute({ children, fallbackPath = "/" }: OrgManagerRouteProps) {
    const { isAuthenticated, isLoading } = useAuth();
    const { isInOrganization } = useOrgRole();
    // Only checks: isAuthenticated + isInOrganization
    // Does NOT check manager role or any permission
    return <>{children}</>;
}
```
**Problem:** Despite the name suggesting it requires manager role, it only checks org membership. The `useOrgRole()` hook only returns `{ activeOrganizationId, isInOrganization }` — no actual role data. The `requiredRole` and `memberRole` props are defined in the interface but never destructured or used.
**Fix:** Rename to `OrgMemberRoute` to reflect actual behavior, remove unused props, or add a `requiredPermission` prop like `AdminRoute`.

#### GAP-F12: `canManageMembers` uses old permission name

**File:** `spa: src/features/Admin/views/OrganizationsPage.tsx` (line ~191)
```typescript
const canManageMembers = can('organization', 'invite');
```
**Problem:** After Phase B6 splits permissions, this will need updating to new fine-grained permission checks.
**Fix:** Replace with appropriate new permission: `can('organization-member', 'add')` and `can('organization-invitation', 'create')` etc. as needed for specific UI sections.

#### GAP-F13: PermissionsContext `isSuperadmin` check uses `user.role` directly

**File:** `spa: src/shared/context/PermissionsContext.tsx` (line 25)
```typescript
const isSuperadmin = user?.role === "superadmin";
```
**Problem:** Uses strict equality on `user.role` which is the *normalized* value from AuthContext. After Phase F1 removes normalization, this must use the new centralized `isSuperadmin` from AuthContext.
**Fix:** Import `isSuperadmin` from AuthContext instead of recomputing it.

### 4.3 Missing Test Coverage

| ID | What's Missing | Where |
|----|---------------|-------|
| MISSING-T1 | Unit tests for permission-only authorization in `AdminService` | `api: admin.service.spec.ts` |
| MISSING-T2 | Unit tests for capability computation replacing role-name checks | `api: admin.service.spec.ts` |
| MISSING-T3 | Unit tests for `OrgImpersonationService` permission-based eligibility | `api: org-impersonation.service.spec.ts` |
| MISSING-T4 | Unit tests for fine-grained org member management permissions | `api: admin-organizations.controller.spec.ts` |
| MISSING-T5 | Structural test proving no role-name strings in service logic | `api: new file` |
| MISSING-T6 | Frontend `AdminOnlyRoute` behavior test (currently broken implementation) | `spa: AdminOnlyRoute.test.tsx` |
| MISSING-T7 | Frontend test for permission error state | `spa: PermissionsContext.test.tsx` |
| MISSING-T8 | Frontend test for custom role handling | `spa: PermissionsContext.test.tsx`, `AdminRoute.test.tsx` |
| MISSING-T9 | `OrgRoleGuard` deprecation/removal — test that no code uses `@OrgRoles` | `api: structural test` |
| MISSING-T10 | Controller role validation accepts custom role names (after DTO change) | `api: admin-users.controller.validation.spec.ts` |
| MISSING-T11 | `permissions.ts` static layer sync or deprecation test | `api: permissions.spec.ts` |
| MISSING-T12 | Session service with `isSuperadmin` boolean instead of `PlatformRole` | `api: sessions.service.spec.ts` |
| MISSING-T13 | Frontend `OrgManagerRoute` rename or permission addition | `spa: OrgManagerRoute.test.tsx` |
| MISSING-T14 | PermissionsContext `isSuperadmin` derived from AuthContext (not recomputed) | `spa: PermissionsContext.test.tsx` |
| MISSING-T15 | Better Auth admin() plugin routes secured or disabled (GAP-B22) | `api: e2e or integration test` |
| MISSING-T16 | `RolesGuard` and `@Roles` decorator confirmed unused — structural test (GAP-B23) | `api: structural test` |
| MISSING-T17 | `OrgImpersonationService.impersonateUser()` + `canImpersonate()` refactored | `api: org-impersonation.service.spec.ts` |
| MISSING-T18 | `stop-impersonating` endpoint requires valid impersonation session token | `api: org-impersonation e2e` |

---

## 5. Permission Taxonomy

### 5.1 Final Permission Set

#### User Permissions
| Permission | Description |
|-----------|-------------|
| `user:create` | Create a new user |
| `user:read` | List/view users and capabilities |
| `user:update` | Update user profile fields |
| `user:delete` | Delete users (single and bulk) |
| `user:ban` | Ban and unban users |
| `user:set-role` | Change a user's org membership role |
| `user:set-password` | Set/reset a user's password |
| `user:impersonate` | Start an impersonation session as a user |

#### Session Permissions
| Permission | Description |
|-----------|-------------|
| `session:read` | List user sessions |
| `session:revoke` | Revoke single or all sessions |

#### Organization Permissions
| Permission | Description |
|-----------|-------------|
| `organization:create` | Create new organization |
| `organization:read` | List/view organizations |
| `organization:update` | Modify organization details |
| `organization:delete` | Delete organization |

#### Organization Membership Permissions (NEW — replacing `organization:invite` + `organization:manage-members`)
| Permission | Description |
|-----------|-------------|
| `organization-member:read` | View org members |
| `organization-member:add` | Add a user to an org |
| `organization-member:remove` | Remove a member from an org |
| `organization-member:update-role` | Change a member's role in an org |
| `organization-member:list-candidates` | List users eligible to join an org |

#### Invitation Permissions (NEW — extracted from `organization:invite`)
| Permission | Description |
|-----------|-------------|
| `organization-invitation:read` | View invitations |
| `organization-invitation:create` | Send invitation |
| `organization-invitation:delete` | Cancel/delete invitation |

#### Role Permissions
| Permission | Description |
|-----------|-------------|
| `role:read` | View roles and their permissions |
| `role:create` | Create new roles |
| `role:update` | Edit role metadata |
| `role:delete` | Delete roles |
| `role:assign` | Assign/modify role permissions |

### 5.2 Permissions to Deprecate

| Old Permission | Replaced By |
|---------------|-------------|
| `organization:invite` | `organization-invitation:create`, `organization-invitation:delete`, `organization-member:add`, `organization-member:list-candidates` |
| `organization:manage-members` | `organization-member:add`, `organization-member:remove`, `organization-member:update-role` |

### 5.3 Default Role Permission Assignments (Post-Migration)

**Admin:** All permissions listed above.

**Manager:** `organization:read`, `organization:create`, `organization:update`, `organization-member:read`, `organization-member:add`, `organization-member:list-candidates`, `organization-invitation:read`, `organization-invitation:create`, `organization-invitation:delete`, `role:read`, `session:read`, `session:revoke`, `user:create`, `user:read`, `user:update`, `user:ban`

**Member:** `organization:read`, `user:read`, `role:read`

---

## 6. Capability Model

### 6.1 Concept

Permissions gate **action eligibility** (you can attempt `user:update`). Capabilities refine **target eligibility** (you can update *this specific* user).

Capability checks answer: **"Does this actor's permission set allow this action on this target, given the target's own permission set and org context?"**

### 6.2 Capability Service (New — Backend)

Create `src/modules/admin/shared/capability.service.ts`:

```typescript
@Injectable()
export class CapabilityService {
  constructor(private readonly roleService: RoleService) {}

  /**
   * Given an actor and target, compute which actions the actor can perform on the target.
   * Uses ONLY permissions, never role names (except superadmin bypass).
   */
  async computeUserCapabilities(params: {
    actorUserId: string;
    isSuperadmin: boolean;
    actorPermissions: string[];        // e.g. ['user:read', 'user:update', ...]
    targetUserId: string;
    targetPermissions: string[];       // e.g. ['organization:read']
    targetInActiveOrganization: boolean;
  }): Promise<UserCapabilities> { ... }

  /**
   * Check if the target has any permission that the actor lacks.
   * If so, the target is "protected" from the actor.
   */
  isProtectedTarget(
    actorPermissions: string[],
    targetPermissions: string[],
  ): boolean { ... }
}
```

### 6.3 Protected Capability Concept

A **protected target** is a user whose permission set includes permissions that the actor does not hold.

**Rules:**
1. Superadmin can always act on any target (except self for destructive ops).
2. If `targetPermissions` includes any permission NOT in `actorPermissions`, the target is "protected" from that actor.
3. Self-actions (update own profile, set own password) are allowed if the actor has the base permission.
4. The "last holder" invariant: if an action would remove the last member holding a critical management permission (e.g. `organization-member:update-role`), the action is blocked regardless of actor permissions.

### 6.4 Capability Computation Logic (Pseudocode)

```
function computeUserCapabilities(actor, target, isSuperadmin):
  isSelf = actor.id === target.id

  if isSuperadmin:
    return all actions=true EXCEPT impersonate-self=false

  if not target.inActiveOrganization:
    return all actions=false

  targetIsProtected = target.permissions has any perm NOT in actor.permissions

  return {
    update:         (isSelf || !targetIsProtected) && 'user:update' in actor.permissions
    setRole:        !isSelf && !targetIsProtected && 'user:set-role' in actor.permissions
    ban:            !isSelf && !targetIsProtected && 'user:ban' in actor.permissions
    unban:          !isSelf && !targetIsProtected && 'user:ban' in actor.permissions
    setPassword:    (isSelf || !targetIsProtected) && 'user:set-password' in actor.permissions
    remove:         !isSelf && !targetIsProtected && 'user:delete' in actor.permissions
    revokeSessions: !isSelf && !targetIsProtected && 'session:revoke' in actor.permissions
    impersonate:    !isSelf && !targetIsProtected && 'user:impersonate' in actor.permissions
  }
```

### 6.5 Organization-Level Capabilities (New Endpoint)

**Endpoint:** `GET /api/platform-admin/organizations/:id/capabilities`
**Permission required:** `organization:read`

Returns what the current actor can do to this org:
```json
{
  "organizationId": "...",
  "actions": {
    "update": true,
    "delete": false,
    "readMembers": true,
    "addMember": true,
    "removeMember": false,
    "updateMemberRole": false,
    "createInvitation": true,
    "deleteInvitation": true,
    "listCandidates": true
  }
}
```

The backend computes this from the actor's permissions in the active org. The frontend uses it instead of local heuristics.

---

## 7. Backend Implementation Phases

### Phase B1: Add New Permissions + Compatibility Layer

**Files to change:**
- `src/modules/admin/rbac/rbac.migration.ts` — new migration `rbac_014_add_fine_grained_member_permissions`

> **Note:** 13 migrations already exist (rbac_001 through rbac_013). The next migration is `rbac_014`.

**Steps:**
1. Add new permissions to `permissions` table: `organization-member:read`, `organization-member:add`, `organization-member:remove`, `organization-member:update-role`, `organization-member:list-candidates`, `organization-invitation:read`, `organization-invitation:create`, `organization-invitation:delete`
2. Backfill to existing roles: Admin gets all, Manager gets subset, Member gets none.
3. Keep old `organization:invite` and `organization:manage-members` temporarily.

**TDD:**
- Write migration test first → run → fail → implement migration → pass.

### Phase B2: Create CapabilityService

**Files to create:**
- `src/modules/admin/shared/capability.service.ts`
- `src/modules/admin/shared/capability.service.spec.ts`

**Steps:**
1. Extract capability computation from `AdminService.getUserCapabilities()` into `CapabilityService`.
2. Replace role-name checks with permission-set comparison.
3. Inject `RoleService` to resolve target permissions.

**TDD: Write these tests FIRST, then implement:**
```
"actor with user:update can update a target with fewer permissions" → pass
"actor with user:update CANNOT update a target with MORE permissions" → pass
"superadmin can update any target" → pass
"self-actions allowed when actor has base permission" → pass
"impersonate blocked for targets with user:impersonate permission" → pass
"last-holder invariant blocks removal of last org manager" → pass
"isProtectedTarget returns true when target has permissions actor lacks" → pass
"isProtectedTarget returns false when actor superset of target" → pass
```

### Phase B3: Refactor AdminService to Use CapabilityService

**Files to change:**
- `src/modules/admin/users/application/services/admin.service.ts`

**Steps:**
1. Replace `getTargetRole()` → use RoleService to get permissions.
2. Replace `assertTargetActionAllowed()` → delegates to `CapabilityService`.
3. Replace `getUserCapabilities()` → delegates to `CapabilityService.computeUserCapabilities()`.
4. Change `CreateUserInput.role` type: `'admin' | 'manager' | 'member'` → `string`.
5. Change `setUserRole()` input role type to `string`.
6. Replace `getAllowedRoleNamesForCreator()` → DB-backed role lookup.

**TDD: Update existing tests in `admin.service.spec.ts`:**
```
"createUser accepts any valid org role name" → pass
"createUser rejects role not in target org" → pass
"setUserRole accepts any valid org role name" → pass
"getUserCapabilities delegates to CapabilityService" → pass
"getUserCapabilities returns capabilities based on permission comparison" → pass
"updateUser capability check uses CapabilityService" → pass
"banUser rejects when target is protected" → pass
"removeUser rejects when target is protected" → pass
```

### Phase B4: Refactor OrgImpersonationService

**Files to change:**
- `src/modules/admin/organizations/application/services/org-impersonation.service.ts`

**Steps:**
1. Remove `MANAGER_ROLES` constant.
2. Remove `canImpersonate()` method (checks `MANAGER_ROLES.includes(memberRole)`).
3. In `startImpersonation()`: replace `platformRole === 'superadmin' || platformRole === 'admin'` branching and `target.role !== 'member'` check → superadmin bypass + permission + capability check via `CapabilityService`.
4. In `impersonateUser()`: replace `canImpersonate(impersonatorMembership.role)` → check that impersonator has `user:impersonate` permission and target is not protected.
5. Inject `CapabilityService` and `RoleService`.
6. Both methods must use the same authorization logic: superadmin can impersonate anyone (except self), non-superadmin needs `user:impersonate` permission + target must not be protected.

**TDD:**
```
"actor WITH user:impersonate CAN impersonate unprotected target" → pass
"actor WITH user:impersonate CANNOT impersonate protected target" → pass
"superadmin can impersonate anyone except themselves" → pass
"actor WITHOUT user:impersonate rejected" → pass (guard handles this)
"org-scoped actor can only impersonate within active org" → pass
"no MANAGER_ROLES constant referenced in source" → pass (structural test)
"canImpersonate() method removed" → pass (structural test)
"impersonateUser() uses CapabilityService, not role-name check" → pass
"startImpersonation() uses CapabilityService, not platformRole branching" → pass
```

### Phase B5: Refactor AdminOrganizationsService

**Files to change:**
- `src/modules/admin/organizations/application/services/admin-organizations.service.ts`

**Steps:**
1. Remove `ROLE_HIERARCHY` constant and `getRoleLevel()` / `filterAssignableRoles()`.
2. Replace `isSuperadminUserRole()` → centralized `isSuperadmin()`.
3. In `create()`: replace `creatorMemberRole = 'admin'` → fetch org's default admin role from DB.
4. Keep `updateMemberRole()` and `removeMember()` — they already use `roleGrantsManagePermission()` ✅.

**TDD:**
```
"create assigns org's default admin role from DB" → pass
"updateMemberRole accepts custom role names" → pass
"addMember accepts custom role names from org roles" → pass
"no ROLE_HIERARCHY constant in source" → pass (structural test)
```

### Phase B6: Update Controller Permission Decorators

**Files to change:**
- `src/modules/admin/organizations/api/controllers/admin-organizations.controller.ts`
- `src/modules/admin/users/api/controllers/admin-users.controller.ts` — relax role enum validation

**Endpoint → New Permission mapping (Organizations):**

| Endpoint | Old Permission | New Permission |
|----------|---------------|----------------|
| `GET /:id/members` | `organization:read` | `organization-member:read` |
| `GET /:id/member-candidates` | `organization:invite` | `organization-member:list-candidates` |
| `POST /:id/members` | `organization:invite` | `organization-member:add` |
| `PUT /:id/members/:memberId/role` | `organization:invite` | `organization-member:update-role` |
| `DELETE /:id/members/:memberId` | `organization:invite` | `organization-member:remove` |
| `GET /:id/invitations` | `organization:read` | `organization-invitation:read` |
| `POST /:id/invitations` | `organization:invite` | `organization-invitation:create` |
| `DELETE /:orgId/invitations/:invitationId` | `organization:invite` | `organization-invitation:delete` |

Also for Users controller:
- `POST /:userId/password` → change from `user:update` (if applicable) to `user:set-password`.

**TDD: Write controller spec tests verifying exact permission decorator per endpoint → fail → update → pass.**

**Additional Users controller changes (GAP-B19):**
- `POST /api/admin/users` — change role validation from `IsIn(['admin','manager','member'])` to `IsString() + IsNotEmpty()`
- `PUT /api/admin/users/:userId/role` — same change
- Add service-level validation: role must exist in target org's role table

**TDD for Users controller:**
```
"createUser accepts custom role name 'editor'" → pass
"createUser rejects empty role string" → pass
"setRole accepts custom role name" → pass
"setRole rejects role not in org" → pass
```

### Phase B7: Clean Up Utils + Deprecate OrgRoleGuard

**Files to change:**
- `src/modules/admin/utils/admin.utils.ts`
- `src/shared/guards/org-role.guard.ts` — audit and deprecate/delete
- `src/modules/admin/sessions/api/controllers/sessions.controller.ts` — update to use `isSuperadmin` boolean
- `src/modules/admin/sessions/application/services/sessions.service.ts` — same

**Steps:**
1. Simplify `getPlatformRole()` → return `'superadmin' | null`. Non-superadmins don't have a "platform role" — they have org-scoped permissions resolved by the guard.
2. Remove `getAllowedRoleNamesForCreator()`.
3. Remove `PlatformRole` type union. Replace with `{ isSuperadmin: boolean }` across the codebase.
4. Rename `requireActiveOrganizationIdForManager()` → `requireActiveOrganizationId()`.
5. Audit `@OrgRoles()` usage — **confirmed unused in any controller**. Delete `OrgRoleGuard`, `@OrgRoles` decorator, and `ORG_ROLES_KEY` constant.
6. Update `SessionsController` and `SessionsService` to accept `isSuperadmin: boolean` instead of `PlatformRole`.
7. Delete `RolesGuard`, `@Roles` decorator, and `ROLES_KEY` constant — **confirmed unused in any controller** (GAP-B23). This removes all dead guard code.

**TDD:**
```
"getPlatformRole returns 'superadmin' for superadmin session" → pass
"getPlatformRole returns null for any other role" → pass
"requireActiveOrganizationId throws for non-superadmin without activeOrgId" → pass
"requireActiveOrganizationId returns null for superadmin" → pass
"no @OrgRoles decorator usage in any controller" → pass (structural test)
"no @Roles decorator usage in any controller" → pass (structural test)
"OrgRoleGuard deleted" → pass
"RolesGuard deleted" → pass
"SessionsController uses isSuperadmin boolean" → pass
"SessionsService uses isSuperadmin boolean" → pass
```

### Phase B8: Add Org-Level Capabilities Endpoint

**Files to change:**
- `src/modules/admin/organizations/api/controllers/admin-organizations.controller.ts` — new method

**TDD:**
```
"GET /api/platform-admin/organizations/:id/capabilities requires organization:read" → pass
"returns correct capabilities for admin actor" → pass
"returns correct capabilities for manager actor" → pass
"returns all-false for member actor" → pass
```

### Phase B9: Reconcile Better Auth Static Layer (GAP-B17) + Secure admin() Plugin Routes (GAP-B22)

**Files to change:**
- `src/permissions.ts` — simplify or deprecate
- `src/permissions.spec.ts` — update
- `src/auth.ts` — restrict admin() plugin if needed

**Steps:**
1. Determine if the `admin()` plugin API routes (`/api/auth/admin/*`) are used by any frontend or external consumer.
2. **Priority: Address security concern (GAP-B22)** — The admin() plugin routes use static `ac`/`roles` for authorization, NOT our DB-backed PermissionsGuard. This means:
   - `POST /api/auth/admin/set-role` can change user roles using only static role checks
   - `POST /api/auth/admin/ban-user` can ban users without DB-backed permission checks
   - `POST /api/auth/admin/impersonate-user` provides a separate impersonation path
3. **Option A (Recommended):** Remove the `admin()` plugin entirely from `auth.ts` if all its functionality is covered by our custom NestJS controllers:
   - User CRUD → `AdminUsersController` ✅
   - Ban/Unban → `AdminUsersController` ✅
   - Set role → `AdminUsersController` ✅
   - Impersonate → `OrgImpersonationController` ✅
   - List users → `AdminUsersController` ✅
   Then simplify `permissions.ts` to only export types if needed.
4. **Option B:** If removing the plugin breaks other Better Auth internals (e.g., `defaultRole` assignment), keep the plugin but:
   - Add NestJS middleware at `/api/auth/admin/*` that rejects requests or proxies them through PermissionsGuard
   - Or use Better Auth's plugin configuration to disable specific routes
5. **Option C (Minimum):** Keep everything but add a structural test that warns about the parallel auth path.
6. Update `permissions.spec.ts` to reflect the new state.
7. If plugin is removed: remove `roleMetadata` from `permissions.ts` (already available from DB via `roles-metadata` endpoint).

**TDD:**
```
"admin() plugin routes /api/auth/admin/* either return 404 or enforce DB-backed permissions" → pass
"permissions.ts does not define role-name-to-permission mappings that conflict with DB" → pass
"no /api/auth/admin/set-role bypass exists" → pass (integration test)
"defaultRole assignment still works for new user signup" → pass
```

---

## 8. Frontend Implementation Phases

### Phase F1: Centralize Superadmin Detection

**Files to change:**
- `spa: src/shared/context/AuthContext.tsx`
- `spa: src/shared/context/PermissionsContext.tsx` — import `isSuperadmin` from AuthContext (GAP-F13)

**Steps:**
1. Remove the full role normalization logic (superadmin > admin > manager > member collapse).
2. Keep only `isSuperadmin: boolean` derived from raw session role.
3. Store `rawRole: string | null` instead of normalized `role`.
4. Export `isSuperadmin` from auth context for the one place it's legitimately needed (org switcher visibility).
5. Update `PermissionsContext` to import `isSuperadmin` from AuthContext instead of recomputing it.

**TDD:**
```
"isSuperadmin is true when session role contains 'superadmin'" → pass
"isSuperadmin is false for any other role" → pass
"rawRole stores the original role string without normalization" → pass
"custom role names are preserved, not collapsed to 'member'" → pass
"PermissionsContext uses isSuperadmin from AuthContext, not local computation" → pass
```

### Phase F2: Fix AdminOnlyRoute (or Delete)

**Files to change:**
- `spa: src/shared/components/AdminOnlyRoute.tsx` — DELETE
- `spa: src/app/views/AppRoutes.tsx` — if roles route was using it

**Recommended:** Delete `AdminOnlyRoute` entirely. Use `AdminRoute` with `requiredPermission` consistently for all admin routes.

**TDD:**
```
"roles route redirects user without role:read permission" → pass
"roles route renders for user with role:read permission" → pass
```

### Phase F3: Remove Frontend Role Hierarchy

**Files to delete:**
- `spa: src/features/Admin/utils/role-hierarchy.ts`
- `spa: src/features/Admin/utils/__tests__/role-hierarchy.test.ts`

**Steps:**
1. Delete `ROLE_HIERARCHY`, `getRoleLevel()`, `filterAssignableRoles()`, `filterVisibleRoles()`.
2. **Confirmed:** No imports of this file exist anywhere in the SPA — zero consumers. Deletion has no runtime impact.
3. If any future usage is needed: fetch assignable roles from **existing** backend endpoint `GET /api/platform-admin/organizations/roles-metadata`.
4. Note: `filterVisibleRoles()` has a bug (`roleLevel < requesterRole` compares number to string) — deletion fixes this too.

**TDD:**
```
"no import of role-hierarchy in any source file" → pass (structural)
"role selector uses backend roles-metadata endpoint" → pass
```

### Phase F4: Update Pages — Remove Role-Name Heuristics

**Files to change:**
- `spa: src/features/Admin/views/UsersPage.tsx`
- `spa: src/features/Admin/views/OrganizationsPage.tsx`
- `spa: src/features/Admin/views/RolesPage.tsx`

**UsersPage changes:**
1. Remove duplicated `isSuperadmin` detection. Use centralized `useAuth().isSuperadmin`.
2. For org-selector: show it when `isSuperadmin` (legitimate use).
3. Remove `role === "admin"` badge styling → use role color from DB.
4. All `can()` permission checks remain (already correct).
5. All backend capability payloads for row actions remain (already correct).

**OrganizationsPage changes:**
1. Remove `isSuperadmin` detection → use centralized hook.
2. Replace `canManageOrganizationFromPage()` heuristic → use backend org capabilities endpoint.
3. Keep `can()` permission checks.
4. Update permission checks for member management to new fine-grained permissions:
   - `can('organization-member', 'add')` instead of `can('organization', 'invite')`
   - `can('organization-invitation', 'create')` instead of `can('organization', 'invite')`
   - etc.

**RolesPage changes:**
1. Remove duplicated `isSuperadmin` detection (line ~169) → use centralized hook.
2. Ensure create/update/delete actions use `can('role', 'create')` / etc.
3. Remove any `isSystem` client-side policy if backend enforces it.

**TDD per page:**
```
"renders without isSuperadmin checks in authorization logic" → pass
"row actions match backend capability payloads" → pass
"uses new fine-grained permissions for org member operations" → pass
```

### Phase F5: Update UserCapabilities Type

**File:** `spa: src/features/Admin/services/adminService.ts`

Change `targetRole: "admin" | "manager" | "member"` → `targetRole: string`.

### Phase F6: Add Permission Error Handling

**File:** `spa: src/shared/context/PermissionsContext.tsx`

**Steps:**
1. Expose `isError` from React Query.
2. Show error UI when `isError && !permissionsLoading`.
3. Allow retry via `refetchPermissions`.

**TDD:**
```
"shows error state when getMyPermissions fails" → pass
"can() returns false when in error state" → pass
"refetchPermissions retries the query" → pass
```

### Phase F7: Rename OrgManagerRoute (GAP-F11)

**Files to change:**
- `spa: src/shared/components/OrgManagerRoute.tsx` — rename to `OrgMemberRoute`
- All import sites

**Steps:**
1. Rename file and component to `OrgMemberRoute` to reflect actual behavior (checks org membership, not manager role).
2. Update all imports and route usages.
3. Optionally add `requiredPermission` prop like `AdminRoute` for future flexibility.

**TDD:**
```
"OrgMemberRoute renders for authenticated org member" → pass
"OrgMemberRoute redirects for non-member" → pass
"OrgMemberRoute redirects for unauthenticated user" → pass
```

---

## 9. Test Plan (TDD)

### 9.1 Backend Unit Tests

Each test file follows the RED-GREEN-REFACTOR cycle: **write failing test → implement minimal solution → green → refactor.**

#### NEW: `src/modules/admin/shared/capability.service.spec.ts`

```
describe('CapabilityService')

  describe('computeUserCapabilities')
    it('superadmin: all actions enabled except impersonate-self')
    it('actor with user:update on unprotected target: update=true')
    it('actor with user:update on protected target: update=false')
    it('self-update allowed when actor has user:update')
    it('self-setRole disallowed even with permission')
    it('target not in active org: all actions disabled for non-superadmin')
    it('impersonate blocked when target has user:impersonate')
    it('ban blocked when target has user:ban')
    it('all actions enabled when actor permissions are superset of target')
    it('returns revokeSessions=true when actor has session:revoke and target unprotected')

  describe('assertActionAllowed')
    it('throws ForbiddenException for protected target')
    it('does not throw for superadmin')
    it('does not throw for unprotected target')
    it('does not throw for self-action when allowed')

  describe('isProtectedTarget')
    it('returns true when target has permissions actor lacks')
    it('returns false when actor has all target permissions')
    it('returns false for targets with no permissions')
    it('returns false for targets with identical permissions as actor')
```

#### UPDATE: `src/modules/admin/users/application/services/admin.service.spec.ts`

```
describe('AdminService — permission-based')

  describe('createUser')
    it('accepts any valid org role name from DB, not just admin/manager/member')
    it('rejects role name not present in target org')
    it('requires organizationId for non-superadmin')
    it('superadmin can create with any org')

  describe('setUserRole')
    it('accepts any valid org role name from DB')
    it('rejects role not in org')
    it('cannot set role when target is protected')

  describe('getUserCapabilities')
    it('delegates to CapabilityService.computeUserCapabilities')
    it('returns capabilities based on permission comparison, not role name')
    it('returns correct self-capabilities')

  describe('updateUser')
    it('uses CapabilityService for target check, not role name')
    it('allows self-update')

  describe('banUser')
    it('rejects when target is protected (has permissions actor lacks)')

  describe('removeUser')
    it('rejects when target is protected')
    it('superadmin can remove any non-superadmin')
```

#### UPDATE: `src/modules/admin/organizations/application/services/org-impersonation.service.spec.ts`

```
describe('OrgImpersonationService — permission-based')

  describe('startImpersonation')
    it('allows when actor has user:impersonate and target is unprotected')
    it('blocks when target has protected permissions')
    it('superadmin can impersonate anyone in any org')
    it('org-scoped actor restricted to active org')
    it('cannot impersonate self')
    it('target must be member of the org')
    it('no platformRole branching in implementation')

  describe('impersonateUser')
    it('allows when impersonator has user:impersonate permission in org')
    it('blocks when target is protected (has permissions impersonator lacks)')
    it('does NOT use canImpersonate() or MANAGER_ROLES')

  describe('stopImpersonation')
    it('deletes session with valid impersonation token')
    it('rejects non-impersonation sessions')
    it('rejects invalid session tokens')
```

#### NEW: Better Auth admin() plugin security test

```
describe('Better Auth admin() plugin routes — security boundary')
  it('/api/auth/admin/set-role returns 404 or is PermissionsGuard-protected')
  it('/api/auth/admin/ban-user returns 404 or is PermissionsGuard-protected')
  it('/api/auth/admin/impersonate-user returns 404 or is PermissionsGuard-protected')
  it('/api/auth/admin/remove-user returns 404 or is PermissionsGuard-protected')
  it('no admin() plugin route can bypass DB-backed RBAC')
```

#### UPDATE: `src/modules/admin/organizations/application/services/admin-organizations.service.spec.ts`

```
describe('AdminOrganizationsService — permission-based')

  describe('create')
    it('assigns default admin role from DB, not hardcoded "admin" string')
    it('superadmin does not get added as member')

  describe('updateMemberRole')
    it('uses roleGrantsManagePermission for last-holder check (already correct)')
    it('accepts custom role names')

  describe('removeMember')
    it('uses roleGrantsManagePermission for last-holder check (already correct)')

  describe('addMember')
    it('accepts custom role names from org roles')
    it('blocks adding superadmin users')
```

#### NEW: `src/modules/admin/no-role-name-coupling.spec.ts`

```
describe('No role-name coupling in non-superadmin service logic')

  // This test reads source files and asserts no hardcoded
  // 'admin', 'manager', 'member' strings appear in service
  // business logic (excluding imports, type defs, test files,
  // and the legitimate 'superadmin' check)

  it('admin.service.ts does not contain hardcoded non-superadmin role strings')
  it('admin-organizations.service.ts does not export ROLE_HIERARCHY')
  it('org-impersonation.service.ts does not contain MANAGER_ROLES')
  it('org-impersonation.service.ts does not contain canImpersonate method')
  it('admin.utils.ts only contains isSuperadmin, no role hierarchy')
  it('no controller uses @OrgRoles decorator')
  it('no controller uses @Roles decorator')
  it('OrgRoleGuard file does not exist (deleted)')
  it('RolesGuard file does not exist (deleted)')
```

#### UPDATE: `src/modules/admin/rbac/rbac.migration.spec.ts`

```
describe('RBAC Migration 014')
  it('creates organization-member:read permission')
  it('creates organization-member:add permission')
  it('creates organization-member:remove permission')
  it('creates organization-member:update-role permission')
  it('creates organization-member:list-candidates permission')
  it('creates organization-invitation:read permission')
  it('creates organization-invitation:create permission')
  it('creates organization-invitation:delete permission')
  it('assigns all new permissions to admin default role')
  it('assigns correct subset to manager default role')
  it('assigns no new permissions to member default role')
```

#### Controller Spec Updates

**`admin-organizations.controller.spec.ts`:**
```
describe('Organization endpoints — fine-grained permissions')
  it('GET /:id/members requires organization-member:read')
  it('GET /:id/member-candidates requires organization-member:list-candidates')
  it('POST /:id/members requires organization-member:add')
  it('PUT /:id/members/:memberId/role requires organization-member:update-role')
  it('DELETE /:id/members/:memberId requires organization-member:remove')
  it('GET /:id/invitations requires organization-invitation:read')
  it('POST /:id/invitations requires organization-invitation:create')
  it('DELETE /:orgId/invitations/:invitationId requires organization-invitation:delete')
  it('GET /:id/capabilities requires organization:read')
  it('GET /roles-metadata requires organization:read')
```

**`admin-users.controller.spec.ts`:**
```
describe('User endpoints — permission verification')
  it('POST /:userId/password requires user:set-password')
  it('POST /:userId/unban requires user:ban')
  it('POST /api/admin/users accepts custom role name')
  it('PUT /api/admin/users/:userId/role accepts custom role name')
  it('POST /api/admin/users rejects empty role string')
```

#### NEW: `src/modules/admin/sessions/application/services/sessions.service.spec.ts` (update)

```
describe('SessionsService — isSuperadmin refactoring')
  it('lists sessions for any user when isSuperadmin=true')
  it('lists sessions only for active org users when isSuperadmin=false')
  it('does not receive PlatformRole string')
```

#### NEW: `src/shared/guards/org-role.guard.spec.ts` (deletion confirmation test)

```
describe('Dead guard cleanup')
  it('no controller imports @OrgRoles decorator')
  it('no controller imports @Roles decorator')
  it('OrgRoleGuard file does not exist after cleanup')
  it('RolesGuard file does not exist after cleanup')
  it('org-role.guard.ts deleted')
  it('roles.guard.ts deleted')
  it('roles.decorator.ts deleted')
```

### 9.2 Frontend Unit Tests

#### UPDATE: `src/shared/context/__tests__/AuthContext.test.tsx`

```
describe('AuthContext — no role normalization')
  it('exposes isSuperadmin=true for superadmin role')
  it('exposes isSuperadmin=false for admin role')
  it('exposes isSuperadmin=false for custom role names like "editor"')
  it('preserves raw role string without normalization')
  it('does not collapse "editor" to "member"')
```

#### UPDATE: `src/shared/context/__tests__/PermissionsContext.test.tsx`

```
describe('PermissionsContext — error handling')
  it('can() returns true for superadmin without API call')
  it('can() uses API-fetched permissions for non-superadmin')
  it('can() returns false when permissions query fails')
  it('shows error state when API returns error')
  it('works with custom role names not in standard set')
  it('refetches permissions on activeOrganizationId change')
```

#### UPDATE: `src/shared/components/__tests__/AdminRoute.test.tsx`

```
describe('AdminRoute — permission-based')
  it('renders children when user has required permission')
  it('redirects when user lacks required permission')
  it('redirects unauthenticated to /login')
  it('works for new permissions like organization-member:read')
```

#### UPDATE: Page tests

**`UsersPage.test.tsx`:**
```
describe('UsersPage — no role-name coupling')
  it('renders without direct isSuperadmin role detection')
  it('row actions match backend capability payloads')
  it('handles custom role names in badge display')
```

**`OrganizationsPage.test.tsx`:**
```
describe('OrganizationsPage — permission-driven')
  it('uses backend org capabilities for management actions')
  it('member management uses fine-grained permissions')
```

### 9.3 E2E Tests (Playwright)

#### Existing tests to verify still pass:
- `e2e/rbac-users-matrix.spec.ts`
- `e2e/rbac-organizations-matrix.spec.ts`
- `e2e/rbac-roles-matrix.spec.ts`
- `e2e/rbac-impersonation.spec.ts`
- `e2e/rbac-capabilities-contract.spec.ts`
- `e2e/rbac-sessions-matrix.spec.ts`

#### New E2E tests:
```
describe('Fine-grained org permissions')
  it('user with organization-member:add but NOT organization-invitation:create can see add-member but not invite')
  it('user with organization-invitation:create but NOT organization-member:add can invite but not add directly')
  it('user with only organization-member:read can view but not modify members')

describe('Custom role support')
  it('custom org role with user:read can access users page')
  it('custom org role without user:read cannot access users page')
  it('custom org role name displays correctly in UI')
```

---

## 10. Action-to-Permission Matrix

This is the **living audit artifact**. Every row must have a test.

| # | Action | Backend Endpoint | Required Permission | Capability Dep. | Frontend Gate | Test File |
|---|--------|-----------------|--------------------|----|--------------|-----------|
| 1 | List users | `GET /api/admin/users` | `user:read` | — | `can('user','read')` | admin-users.ctrl.spec |
| 2 | User capabilities | `GET /api/admin/users/:id/capabilities` | `user:read` | — | `can('user','read')` | admin-users.ctrl.spec |
| 3 | Batch capabilities | `POST /api/admin/users/capabilities/batch` | `user:read` | — | `can('user','read')` | admin-users.ctrl.spec |
| 4 | Create metadata | `GET /api/admin/users/create-metadata` | `user:read` | — | `can('user','read')` | admin-users.ctrl.spec |
| 5 | Create user | `POST /api/admin/users` | `user:create` | — | `can('user','create')` | admin-users.ctrl.spec |
| 6 | Update user | `PUT /api/admin/users/:id` | `user:update` | cap.update | `can('user','update')` + cap | admin-users.ctrl.spec |
| 7 | Set role | `PUT /api/admin/users/:id/role` | `user:set-role` | cap.setRole | `can('user','set-role')` + cap | admin-users.ctrl.spec |
| 8 | Ban user | `POST /api/admin/users/:id/ban` | `user:ban` | cap.ban | `can('user','ban')` + cap | admin-users.ctrl.spec |
| 9 | Unban user | `POST /api/admin/users/:id/unban` | `user:ban` | cap.unban | `can('user','ban')` + cap | admin-users.ctrl.spec |
| 10 | Set password | `POST /api/admin/users/:id/password` | `user:set-password` | cap.setPassword | `can('user','set-password')` + cap | admin-users.ctrl.spec |
| 11 | Delete user | `DELETE /api/admin/users/:id` | `user:delete` | cap.remove | `can('user','delete')` + cap | admin-users.ctrl.spec |
| 12 | Bulk delete | `POST /api/admin/users/bulk-delete` | `user:delete` | cap.remove | `can('user','delete')` | admin-users.ctrl.spec |
| 13 | Impersonate | `POST /api/admin/users/:id/impersonate` | `user:impersonate` | cap.impersonate | `can('user','impersonate')` + cap | admin-users.ctrl.spec |
| 14 | List sessions | `GET /api/admin/users/:id/sessions` | `session:read` | — | `can('session','read')` | sessions.ctrl.spec |
| 15 | Revoke session | `POST /api/admin/users/sessions/revoke` | `session:revoke` | — | `can('session','revoke')` | sessions.ctrl.spec |
| 16 | Revoke all | `POST /api/admin/users/:id/sessions/revoke-all` | `session:revoke` | — | `can('session','revoke')` | sessions.ctrl.spec |
| 17 | List orgs | `GET /api/platform-admin/organizations` | `organization:read` | — | `can('organization','read')` | admin-orgs.ctrl.spec |
| 18 | Get org | `GET /api/platform-admin/organizations/:id` | `organization:read` | — | `can('organization','read')` | admin-orgs.ctrl.spec |
| 19 | Create org | `POST /api/platform-admin/organizations` | `organization:create` | — | `can('organization','create')` | admin-orgs.ctrl.spec |
| 20 | Update org | `PUT /api/platform-admin/organizations/:id` | `organization:update` | — | `can('organization','update')` | admin-orgs.ctrl.spec |
| 21 | Delete org | `DELETE /api/platform-admin/organizations/:id` | `organization:delete` | — | `can('organization','delete')` | admin-orgs.ctrl.spec |
| 22 | Org capabilities | `GET /api/platform-admin/organizations/:id/capabilities` | `organization:read` | — | `can('organization','read')` | admin-orgs.ctrl.spec |
| 23 | List members | `GET /.../organizations/:id/members` | `organization-member:read` | — | `can('organization-member','read')` | admin-orgs.ctrl.spec |
| 24 | List candidates | `GET /.../organizations/:id/member-candidates` | `organization-member:list-candidates` | — | `can('organization-member','list-candidates')` | admin-orgs.ctrl.spec |
| 25 | Add member | `POST /.../organizations/:id/members` | `organization-member:add` | — | `can('organization-member','add')` | admin-orgs.ctrl.spec |
| 26 | Update member role | `PUT /.../members/:memberId/role` | `organization-member:update-role` | last-holder | `can('organization-member','update-role')` | admin-orgs.ctrl.spec |
| 27 | Remove member | `DELETE /.../members/:memberId` | `organization-member:remove` | last-holder | `can('organization-member','remove')` | admin-orgs.ctrl.spec |
| 28 | List invitations | `GET /.../organizations/:id/invitations` | `organization-invitation:read` | — | `can('organization-invitation','read')` | admin-orgs.ctrl.spec |
| 29 | Create invitation | `POST /.../organizations/:id/invitations` | `organization-invitation:create` | — | `can('organization-invitation','create')` | admin-orgs.ctrl.spec |
| 30 | Delete invitation | `DELETE /.../invitations/:invitationId` | `organization-invitation:delete` | — | `can('organization-invitation','delete')` | admin-orgs.ctrl.spec |
| 31 | List roles | `GET /api/rbac/roles` | `role:read` | — | `can('role','read')` | rbac.ctrl.spec |
| 32 | Get role | `GET /api/rbac/roles/:id` | `role:read` | — | `can('role','read')` | rbac.ctrl.spec |
| 33 | Create role | `POST /api/rbac/roles` | `role:create` | — | `can('role','create')` | rbac.ctrl.spec |
| 34 | Update role | `PUT /api/rbac/roles/:id` | `role:update` | — | `can('role','update')` | rbac.ctrl.spec |
| 35 | Delete role | `DELETE /api/rbac/roles/:id` | `role:delete` | — | `can('role','delete')` | rbac.ctrl.spec |
| 36 | Assign permissions | `PUT /api/rbac/roles/:id/permissions` | `role:assign` | — | `can('role','assign')` | rbac.ctrl.spec |
| 37 | My permissions | `GET /api/rbac/my-permissions` | (authenticated) | — | — | rbac.ctrl.spec |
| 38 | List all permissions | `GET /api/rbac/permissions` | `role:read` | — | — | rbac.ctrl.spec |
| 39 | Permissions grouped | `GET /api/rbac/permissions/grouped` | `role:read` | — | — | rbac.ctrl.spec |
| 40 | Role permissions by name | `GET /api/rbac/users/:roleName/permissions` | `role:read` | — | — | rbac.ctrl.spec |
| 41 | Check role permission | `GET /api/rbac/check/:roleName/:resource/:action` | `role:read` | — | — | rbac.ctrl.spec |
| 42 | Roles metadata | `GET /api/platform-admin/organizations/roles-metadata` | `organization:read` | — | — | admin-orgs.ctrl.spec |
| 43 | Org impersonate | `POST /api/organization/:orgId/impersonate` | `user:impersonate` | cap.impersonate | `can('user','impersonate')` + cap | org-impersonation.ctrl.spec |
| 44 | Stop impersonating | `POST /api/organization/stop-impersonating` | (authenticated — validates session token) | — | — | org-impersonation.ctrl.spec |

---

## 11. Migration & Compatibility

### 11.1 Strategy

**Phase 1 (additive):** Add new fine-grained permissions alongside old ones. Both old and new exist in DB.

**Phase 2 (shift):** Update controller decorators and frontend `can()` calls to use new permissions. Old permissions still assigned to roles but no longer checked.

**Phase 3 (cleanup):** Remove old permissions (`organization:invite`, `organization:manage-members`) via migration `rbac_015_remove_legacy_permissions`.

### 11.2 Migration `rbac_014` Logic

```sql
-- 1. Insert new permissions
INSERT INTO permissions (id, resource, action, description)
VALUES
  (gen_id(), 'organization-member', 'read', 'View organization members'),
  (gen_id(), 'organization-member', 'add', 'Add member to organization'),
  (gen_id(), 'organization-member', 'remove', 'Remove member from organization'),
  (gen_id(), 'organization-member', 'update-role', 'Update member role'),
  (gen_id(), 'organization-member', 'list-candidates', 'List member candidates'),
  (gen_id(), 'organization-invitation', 'read', 'View org invitations'),
  (gen_id(), 'organization-invitation', 'create', 'Create org invitation'),
  (gen_id(), 'organization-invitation', 'delete', 'Delete org invitation')
ON CONFLICT DO NOTHING;

-- 2. For each role that has organization:invite, add new permissions
-- 3. For each role that has organization:manage-members, add new permissions
-- 4. For each role that has organization:read, add organization-member:read and organization-invitation:read
```

### 11.3 Compatibility Window

During Phases 1-2:
- Old permissions remain in DB and assigned to roles → nothing breaks.
- New permissions also assigned → controllers can start requiring them.
- Frontend switches `can()` calls → uses new permissions.

After Phase 3:
- Old permissions removed → only new remain.

---

## 12. Execution Order

Each step must pass all tests before proceeding.

| Step | Phase | What | Risk | Run After |
|------|-------|------|------|-----------|
| 1 | B1 | Add new permissions migration (rbac_014) | Low | Full test suite |
| 2 | B2 | Create CapabilityService + tests | Low | Full test suite |
| 3 | B3 | Refactor AdminService → CapabilityService | Medium | Full test suite |
| 4 | B4 | Refactor OrgImpersonationService | Medium | Full test suite + impersonation e2e |
| 5 | B5 | Refactor AdminOrganizationsService | Medium | Full test suite |
| 6 | B6 | Update controller permission decorators + relax role validation | Medium | Full test suite + full e2e |
| 7 | B7 | Clean up utils + delete OrgRoleGuard/RolesGuard + update SessionsController | Low | Full test suite |
| 8 | B8 | Add org capabilities endpoint | Low | Full test suite |
| 9 | B9 | Secure/remove Better Auth admin() plugin routes + reconcile permissions.ts | **High** | Full test suite + verify /api/auth/admin/* routes |
| 10 | F1 | Frontend: centralize superadmin + fix PermissionsContext | Medium | Full SPA test suite |
| 11 | F2 | Frontend: fix/remove AdminOnlyRoute | Low | Full SPA test suite |
| 12 | F3 | Frontend: remove role hierarchy | Low | Full SPA test suite |
| 13 | F4 | Frontend: update pages (Users, Orgs, Roles) | Medium | Full test suite + full e2e |
| 14 | F5 | Frontend: update types (UserCapabilities) | Low | Full SPA test suite |
| 15 | F6 | Frontend: permission error handling | Low | Full SPA test suite |
| 16 | F7 | Frontend: rename OrgManagerRoute → OrgMemberRoute | Low | Full SPA test suite |
| 17 | — | Remove legacy permissions (cleanup migration rbac_015) | Low | Full test suite + full e2e |
| 18 | — | Final audit: structural test + matrix review | — | All suites |

---

## 13. Acceptance Criteria

- [ ] Every non-superadmin admin action has an explicit, fine-grained permission (44-row matrix in Section 10).
- [ ] Every admin endpoint's `@RequirePermissions` matches the matrix.
- [ ] No backend service/util code for non-superadmins contains hardcoded role names. Structural test proves this.
- [ ] `ROLE_HIERARCHY`, `MANAGER_ROLES`, `canImpersonate()`, and `PlatformRole` union removed from service/util code.
- [ ] `CapabilityService` exists and uses permission-set comparison, not role names.
- [ ] `AdminService.getUserCapabilities()` delegates to `CapabilityService`.
- [ ] `OrgImpersonationService` uses permission + capability check, not role name check. Both `startImpersonation()` and `impersonateUser()` refactored.
- [ ] `AdminOrganizationsService.create()` assigns org role from DB, not hardcoded `'admin'`.
- [ ] Controller DTO validation accepts any valid org role string (not enum whitelist).
- [ ] `OrgRoleGuard`, `@OrgRoles` decorator, `RolesGuard`, and `@Roles` decorator all deleted (confirmed dead code).
- [ ] `SessionsController`/`SessionsService` use `isSuperadmin: boolean`, not `PlatformRole`.
- [ ] Better Auth `permissions.ts` is reconciled (minimal or deprecated).
- [ ] Better Auth `admin()` plugin routes either disabled, removed, or secured behind DB-backed RBAC (GAP-B22).
- [ ] Frontend route access is fully permission-driven via `AdminRoute` + `requiredPermission`.
- [ ] Frontend `AuthContext` does not normalize roles to `admin|manager|member`.
- [ ] Frontend `PermissionsContext` imports `isSuperadmin` from `AuthContext` (not local computation).
- [ ] Frontend sidebar uses `can()` only (verify preserved).
- [ ] Frontend pages do not contain `isSuperadmin` heuristics from role strings (except centralized hook in AuthContext).
- [ ] `role-hierarchy.ts` deleted from frontend (confirmed dead code — not imported anywhere).
- [ ] `AdminOnlyRoute` deleted (confirmed dead code — not used in any route).
- [ ] `OrgManagerRoute` renamed to `OrgMemberRoute`; unused `requiredRole`/`memberRole` props removed.
- [ ] `UserCapabilities.targetRole` accepts `string`, not hardcoded union.
- [ ] `PermissionsContext` handles API errors gracefully.
- [ ] Same-named roles in different orgs don't leak permissions (verify preserved via org-scoped DB queries).
- [ ] `superadmin` bypass unchanged in guard and `PermissionsContext`.
- [ ] All backend unit tests pass.
- [ ] All frontend unit tests pass.
- [ ] All e2e tests pass.
- [ ] Structural no-coupling test passes.
- [ ] No parallel admin API path exists that bypasses DB-backed RBAC.

---

## 14. Out of Scope

- Changing `superadmin` semantics or bypass behavior.
- Redesigning Better Auth internals (but reconciling/securing `permissions.ts` and `admin()` plugin IS in scope).
- Audit logging infrastructure.
- Non-admin end-user permissions outside admin/RBAC surfaces.
- Performance optimization of permission queries (address later if needed).
- UI/UX redesign of admin pages beyond permission gating.
- Multi-tenant permission isolation (already handled by org-scoped roles).
- Implementing the `useOrgRole()` hook with actual role data (only relevant if `OrgMemberRoute` needs permission checking; currently org membership check is sufficient).

---

## 15. Dual Auth System Reference

### Context

The codebase has **two separate authorization layers** that must not be confused:

### Layer 1: Better Auth Static Layer (`src/permissions.ts`)

```typescript
// Static compile-time definitions consumed by Better Auth admin() plugin
export const ac = createAccessControl(statement);
export const roles = { superadmin, admin, manager, member };
```

- **What it is:** A static AccessControl object passed to `betterAuth({ plugins: [admin({ ac, roles })] })` in `src/auth.ts`.
- **What it does:** Defines permissions for Better Auth's BUILT-IN admin API routes (e.g., `/api/auth/admin/...`).
- **What it does NOT do:** Has NO effect on our custom NestJS controllers or `PermissionsGuard`.
- **Hardcoded role names:** `superadmin`, `admin`, `manager`, `member` with their own action sets.
- **Statement vocabulary:** Uses `"list"`, `"get"` instead of `"read"` — different from DB layer.
- **`roleMetadata`:** Defines display names and colors for 4 roles.

### Layer 2: TypeORM RBAC Layer (DB-backed, authoritative)

- **What it is:** Dynamic, org-scoped roles/permissions stored in PostgreSQL.
- **What it does:** `PermissionsGuard` resolves permissions from DB via `RoleService.getUserPermissions()`.
- **Tables:** `roles`, `permissions`, `role_permissions`, `member`, `invitation`.
- **Custom roles:** Supported per-organization. No limit to 4 role names.
- **This is the authoritative layer** for all custom NestJS endpoint authorization.

### Resolution Path

The plan addresses this in Phase B9. Options:
1. **Remove `admin()` plugin entirely (Recommended)** — All its functionality is already covered by custom NestJS controllers (see Phase B9 for verification matrix). This eliminates the parallel auth path and the static role definitions.
2. **Keep `admin()` plugin but secure its routes** — Add NestJS middleware at `/api/auth/admin/*` that applies PermissionsGuard-equivalent checks, or use Better Auth configuration to disable individual routes.
3. **Sync the two layers** — keep both but auto-generate `permissions.ts` from DB state (complex, not recommended).

### Better Auth admin() Plugin Route Inventory (GAP-B22)

These routes are automatically registered by `admin()` and use the static `ac`/`roles` for authorization:

| Method | Route | What It Does | Custom Controller Equivalent |
|--------|-------|-------------|------------------------------|
| POST | `/api/auth/admin/set-role` | Set user platform role | `PUT /api/admin/users/:userId/role` |
| POST | `/api/auth/admin/ban-user` | Ban a user | `POST /api/admin/users/:userId/ban` |
| POST | `/api/auth/admin/unban-user` | Unban a user | `POST /api/admin/users/:userId/unban` |
| POST | `/api/auth/admin/impersonate-user` | Impersonate (global) | `POST /api/organization/:orgId/impersonate` |
| POST | `/api/auth/admin/remove-user` | Remove a user | `DELETE /api/admin/users/:userId` |
| GET | `/api/auth/admin/users` | List all users | `GET /api/admin/users` |

**Security risk:** Every route above can be accessed without DB-backed RBAC checks, using only the static role definitions in `permissions.ts`.

---

## 16. Dead Code Inventory

All items confirmed via exhaustive codebase search (iteration 3). Safe to delete.

### API Dead Code

| File | Component | Evidence | Action |
|------|-----------|----------|--------|
| `src/shared/guards/org-role.guard.ts` | `OrgRoleGuard` + `@OrgRoles()` decorator | `@OrgRoles` not used in any controller; `request.orgMemberRole` never set by any middleware/interceptor | DELETE entirely |
| `src/shared/guards/roles.guard.ts` | `RolesGuard` | `@Roles` not used in any controller endpoint | DELETE entirely |
| `src/shared/decorators/roles.decorator.ts` | `@Roles()` decorator + `ROLES_KEY` | Not used in any controller | DELETE entirely |

### SPA Dead Code

| File | Component | Evidence | Action |
|------|-----------|----------|--------|
| `src/shared/components/AdminOnlyRoute.tsx` | `AdminOnlyRoute` | Not used in any route in `AppRoutes.tsx`. All admin routes use `AdminRoute`. | DELETE |
| `src/features/Admin/utils/role-hierarchy.ts` | `ROLE_HIERARCHY`, `getRoleLevel`, `filterAssignableRoles`, `filterVisibleRoles` | NOT imported anywhere in the SPA. Zero consumers. Contains bug in `filterVisibleRoles()`. | DELETE (+ test file) |
| `src/shared/components/OrgManagerRoute.tsx` | `OrgManagerRoute` (unused props) | `requiredRole` and `memberRole` props defined but never destructured or used | RENAME to `OrgMemberRoute`, remove unused props |
