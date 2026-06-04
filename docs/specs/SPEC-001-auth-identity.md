---
id: SPEC-001
title: "SPEC-001: Auth & identity contract (better-auth, approval, permissions)"
status: Implemented
layer: contract
owner: Mariano Ravinale
created: 2026-06-04
updated: 2026-06-04
feature_paths:
  - src/auth.ts
  - src/shared/guards/permissions.guard.ts
  - src/modules/admin/users/api/controllers/admin-users.controller.ts
  - src/modules/admin/rbac/api/controllers/rbac.controller.ts
related_adrs: [ADR-002, ADR-003]
related_specs: []
counterpart_spec: "spa-velocity#SPEC-001"
coordination_doc: ""
---

# SPEC-001: Auth & identity contract

> **Backfill** — current, test-backed contract. ACs map to existing Jest specs. The `ui` counterpart
> (`spa-velocity#SPEC-001`) consumes these endpoints.

## 1. Summary (intended behavior)

better-auth provides email/password auth with a **bearer/JWT** credential (basePath `/api/auth`;
plugins: bearer, jwt, openAPI, organization, admin; new users default to `member`; email verification
+ password reset enabled). Access is gated by `PermissionsGuard`, which **fails closed on approval
status** (pending/rejected → 403) and resolves RBAC permissions (superadmin bypass; org-membership
role when `user.role` is null). The approval state machine is pending → approved/rejected, with a
self-approve path for accepted invitations.

## 2. Context & problem

This is the backend trust boundary the SPA depends on; it was undocumented. Two load-bearing rules:
the guard's **approval enforcement** (migration-safe: a missing column allows access) and the
**superadmin bypass**. Throws use NestJS built-ins (ADR-003, no global exception filter).

## 3. Scope

**In scope:** better-auth config (bearer/JWT, member default, verification, reset-token TTL), the
approval endpoints + state machine, `PermissionsGuard` (auth + approval + permission resolution),
the `my-permissions` resolution.

**Out of scope / non-goals (thin coverage — §9):** email-verification/password-reset completion
endpoint internals (better-auth built-ins), organization invitation acceptance contract.

## 4. Assumptions

1. [Confirmed] New users default to `member`; bearer + JWT plugins enabled; reset-token TTL = 86400s (`auth.spec.ts:21,33,47`).
2. [Confirmed] `PermissionsGuard` throws 403 on pending/rejected approval and swallows a missing-column error (allows) (`permissions.guard.spec.ts:188,201,214,228`).
3. [Confirmed] Superadmin bypasses permission resolution; null `user.role` resolves the org-membership role (`permissions.guard.spec.ts:86,162`).
4. [Confirmed] `my-permissions`: superadmin → all; org-scoped → role perms; no active org → `[]` (`rbac.controller.spec.ts:66,83,104`).

## 5. Affected areas

- `src/auth.ts` (better-auth config), `src/shared/guards/permissions.guard.ts`.
- `src/modules/admin/users/api/controllers/admin-users.controller.ts` (approval endpoints).
- `src/modules/admin/rbac/api/controllers/rbac.controller.ts` (`/api/rbac/my-permissions`).
- Entities/migrations: `user` (`approvalStatus`, `rejectionReason` columns, migration-gated); better-auth tables (`user`, `session`, `verification`, `account`).
- Endpoints: `POST /api/auth/{sign-in,sign-up,sign-out,verify-email,reset-password}`, `GET /api/auth/get-session`, `GET /api/admin/users/me/approval-status`, `POST /api/admin/users/self-approve-invited`, `GET /api/rbac/my-permissions`.

## 6. Acceptance criteria (mapped to existing tests)

| # | Criterion | Proving test |
|---|---|---|
| AC1 | better-auth: reset-token TTL 86400; bearer + admin(member-default) plugins configured | `src/auth.spec.ts:21,33,47` |
| AC2 | `getMyApprovalStatus` returns status+reason; treats null user / missing migration as approved | `admin-users.controller.spec.ts:552,570,581` |
| AC3 | `selfApproveInvited`: already-approved when absent; 403 when pending w/o accepted invite; auto-approve with accepted invite | `admin-users.controller.spec.ts:596,616,629` |
| AC4 | `approve`/`reject` pass actor context; reject rejects an over-long reason (>500) | `admin-users.controller.spec.ts:669,685,701` |
| AC5 | `PermissionsGuard`: pending → 403 ACCOUNT_PENDING_APPROVAL; rejected → 403 ACCOUNT_REJECTED; missing column → allow | `permissions.guard.spec.ts:188,201,214,228` |
| AC6 | `PermissionsGuard`: superadmin bypass; null `user.role` resolves org-membership role | `permissions.guard.spec.ts:86,162` |
| AC7 | `my-permissions`: superadmin → all; org-scoped → role perms; no active org → `[]`; null role → resolves membership | `rbac.controller.spec.ts:66,83,104,114` |

## 7. Implementation plan

N/A — backfill. Future auth/identity changes update this spec first.

## 8. Testing plan

Jest unit: `src/auth.spec.ts`, `src/shared/guards/permissions.guard.spec.ts`, `src/modules/admin/users/api/controllers/admin-users.controller.spec.ts`, `src/modules/admin/rbac/api/controllers/rbac.controller.spec.ts`. Run `npx jest src/auth.spec.ts src/shared/guards src/modules/admin/users src/modules/admin/rbac`.

## 9. Risks & failure modes

- Approval enforcement is the security gate; it **fails closed** on pending/rejected but **fails open** on a missing column (intentional migration-safety) — acceptable while the column rolls out, risky if it silently never lands.
- Email-verification/password-reset completion is better-auth-internal → **unverified** here.
- Org invitation acceptance contract is not fully documented (thin).

## 10. Open questions

- Should this spec own the approval state-machine as the SSoT, or `spa-velocity#SPEC-001`? (Cross-repo decision.)

## Change Log

- 2026-06-04 · PR (backfill) · created · documents the auth/identity contract; 7 ACs mapped to existing Jest specs.
