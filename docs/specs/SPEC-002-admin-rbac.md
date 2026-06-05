---
id: SPEC-002
title: "SPEC-002: Admin & RBAC contract (users, sessions, orgs, roles, impersonation)"
status: Implemented
layer: contract
owner: Mariano Ravinale
created: 2026-06-04
updated: 2026-06-04
feature_paths:
  - src/modules/admin
related_adrs: [ADR-002]
related_specs: [SPEC-001]
counterpart_spec: "spa-velocity#SPEC-002"
coordination_doc: ""
---

# SPEC-002: Admin & RBAC contract

> **Backfill** — current, test-backed contract. ACs map to existing Jest specs. The `ui` counterpart
> is `spa-velocity#SPEC-002`.

## 1. Summary (intended behavior)

The admin module exposes RBAC-gated endpoints for **users** (CRUD, approve/reject, ban/unban,
set-role, set-password, delete, bulk-delete, capabilities), **sessions** (list/revoke/revoke-all),
**organizations** (CRUD, members, invitations), **impersonation** (platform + org-scoped), and
**roles & permissions** (CRUD + assign). The org-scope contract (ADR-002): `scope=all` is superadmin-
only (non-superadmin → **400**); no org context → **403**. Permission assignment is guarded against
self-escalation (you can't grant what you don't hold).

## 2. Context & problem

Highest-privilege backend surface; undocumented. Load-bearing rules: the ADR-002 scope contract, the
self-escalation guard on permission assignment, and reserved-role-name protection (`superadmin`,
`user`).

## 3. Scope

**In scope:** user CRUD + validation, session scoping/revocation, organization CRUD/members,
impersonation (platform + org), roles CRUD, permission-assignment self-escalation guard, the ADR-002
`scope=all`/no-org contract, `my-permissions` (shared with SPEC-001).

**Out of scope / non-goals (thin coverage — §9):** org invitation acceptance DTO/flow, role-deletion
in-use constraint (no integration test), runtime custom-permission creation (perms are migration-seeded),
session-revocation response shape, bulk-delete partial-failure semantics.

## 4. Assumptions

1. [Confirmed] `scope=all` by superadmin → cross-org (null org); by non-superadmin → 400; no org context → 403 (`org-scope.utils.spec.ts:18,37,48`).
2. [Confirmed] Create-user validates name/email/password(≥8)/role; non-admin role requires organizationId (`admin-users.controller.spec.ts:438,456,471`).
3. [Confirmed] Permission assignment is self-escalation-guarded (403 to grant a permission you lack) (`rbac.controller.spec.ts:186` + controller guard).
4. [Confirmed] Roles reject reserved names (`superadmin`,`user`); superadmin must pass organizationId (400 if missing).
5. [Unconfirmed] Org invitation acceptance + role-deletion in-use constraint — behavior exists but not test-covered (§9).

## 5. Affected areas

- `src/modules/admin/{users,sessions,organizations,rbac}/api/controllers/*` + services.
- `src/shared/guards/permissions.guard.ts`; `src/modules/admin/users/utils/org-scope.utils.ts`.
- Entities/migrations: `roles`, `permissions`, `role_permissions`, `organization`, `organization_members`; RBAC seed migration (`rbac.migration.ts`).
- Endpoints: `/api/admin/users/*`, `/api/admin/users/{id}/{role,password,ban,unban,impersonate,sessions,capabilities}`, `/api/admin/users/sessions/revoke`, `/api/platform-admin/organizations/*`, `/api/organization/{:id/impersonate,stop-impersonating}`, `/api/rbac/{roles,permissions,check}*`.

## 6. Acceptance criteria (mapped to existing tests)

| # | Criterion | Proving test |
|---|---|---|
| AC1 | Org-scope: superadmin `scope=all` → cross-org; non-superadmin `scope=all` → 400; member → 400 | `org-scope.utils.spec.ts:18,37,48` |
| AC2 | Create-user validation: missing name → throw; password <8 → throw; non-admin role w/o org → throw | `admin-users.controller.spec.ts:438,456,471` |
| AC3 | Users: create (admin / member+org), list with parsed pagination + default limit/offset | `admin-users.controller.spec.ts:368,385,305,339` |
| AC4 | Sessions: superadmin null-scope / `?organizationId`; non-superadmin cross-org rejected; revoke rejects empty/whitespace token | `sessions.controller.spec.ts:74,99,111,178` |
| AC5 | Organizations: member role update + remove forward actor role; roles-metadata passes platform role | `admin-organizations.controller.spec.ts:44,68,94` |
| AC6 | Impersonation: org-scoped returns sessionToken; 403 when session has no user | `org-impersonation.controller.spec.ts:60,84` |
| AC7 | Roles: org-scoped list for managers; all-roles for superadmin when org omitted; create in active org | `rbac.controller.spec.ts:262,297,345` |
| AC8 | RBAC write ops require specific role permissions (self-escalation guard) | `rbac.controller.spec.ts:186` |

## 7. Implementation plan

N/A — backfill. Future admin/RBAC changes update this spec first.

## 8. Testing plan

Jest unit: `src/modules/admin/**/*.spec.ts` (admin-users, sessions, organizations, org-impersonation, rbac controllers; org-scope.utils). Run `npx jest src/modules/admin`.

## 9. Risks & failure modes

- ADR-002 scope contract is the multi-tenant isolation boundary; both arms (400/403) are tested.
- Org invitation acceptance + role-deletion-in-use + bulk-delete partial-failure are **unverified** (thin) → next changes there add tests.
- FE affordances are UX; this contract (+ guard) is the authority.

## 10. Open questions

- Should the role/permission catalog be the SSoT this contract owns and the FE renders? (Cross-repo, with `spa-velocity#SPEC-002`.)

## Change Log

- 2026-06-04 · PR (backfill) · created · documents the admin/RBAC contract; 8 ACs mapped to existing Jest specs.
