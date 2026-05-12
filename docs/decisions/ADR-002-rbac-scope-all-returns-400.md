# ADR-002: RBAC `scope=all` by non-superadmin returns 400, not 403

**Status:** Accepted
**Date:** 2026-04-30 (retroactively documented)
**Deciders:** core engineering team

## Context

The RBAC layer supports two scope values for cross-organization queries:

- `scope=single` (default) — operate within `activeOrganizationId`.
- `scope=all` — operate across organizations; restricted to superadmin.

Most authorization frameworks return **403 Forbidden** for any request the current user can't make. We deliberately diverge: a non-superadmin requesting `scope=all` gets **400 BadRequestException**, while permission mismatches *within* an authorized scope get **403 ForbiddenException**.

The distinction matters because consumers reading the response need to tell "I'm using the API wrong" apart from "I'm not allowed to do this".

## Decision

The error mapping is:

| Situation | HTTP | Exception |
|---|---|---|
| `scope=all` requested by non-superadmin | **400** | `BadRequestException("scope=all requires superadmin")` |
| Permission mismatch inside an authorized scope | **403** | `ForbiddenException` |
| Cross-org access attempt (org_id mismatch) | **403** | `ForbiddenException` |
| Missing org context | **403** | `ForbiddenException` |
| Valid request, resource not found | **404** | `NotFoundException` |

Never return 404 to hide a permission failure. Never return 401 from the RBAC layer (auth has already happened by then).

## Alternatives considered

- **403 everywhere.** Rejected: collapses two distinct semantics. A consumer can't tell whether to retry with different scope semantics or escalate to an admin.
- **Custom 422 for "scope=all by non-superadmin".** Rejected: 400 is the correct HTTP semantic for "client sent an unsupported parameter combination". 422 is for syntactically valid but semantically invalid inputs, which `scope=all` is not — it's a forbidden-by-role parameter, framed as a request error.
- **Allow non-superadmin to send `scope=all` and silently filter.** Rejected: violates fail-fast; consumers depend on the explicit response to detect misconfigured clients.

## Consequences

- **Positive:** clear distinction in the API contract; frontends/clients can route 400 vs 403 to different UX paths.
- **Negative:** non-standard relative to "always 403 on auth failures"; needs documentation for new consumers.
- **Follow-ups:** this contract is enforced in `PermissionsGuard` ([src/shared/guards/permissions.guard.ts](../../src/shared/guards/permissions.guard.ts)); negative-case tests on routes that accept `scope` MUST cover both the 400 and 403 paths.

## References

- [src/shared/guards/permissions.guard.ts](../../src/shared/guards/permissions.guard.ts).
- [src/modules/admin/users/utils/org-scope.utils.ts](../../src/modules/admin/users/utils/org-scope.utils.ts) — `resolveOrgScope()`.
- `CLAUDE.md` § P2 — RBAC scope contract restatement.
- `.claude/skills/repo-conventions/SKILL.md` § "RBAC scope contract" — enforcement detail.
- `.claude/agents/security-reviewer.md` § "Project-specific RBAC checks" — review-time verification.
