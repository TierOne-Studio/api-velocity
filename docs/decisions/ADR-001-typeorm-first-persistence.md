# ADR-001: TypeORM-first persistence with raw-SQL fallback

**Status:** Accepted
**Date:** 2026-04-30 (retroactively documented; decision originally encoded during the RBAC module migration to TypeORM)
**Deciders:** core engineering team

## Context

The repo's original persistence pattern was raw SQL via a custom `DatabaseService` and per-module repository classes (`ProjectsRepository`, `ChatRepository`, `AdminUsersRepository`). When the RBAC module was added, it adopted TypeORM (`@nestjs/typeorm`, entity classes, `@InjectRepository`). The codebase now has two patterns coexisting.

A clear forward-looking convention is needed so new modules don't pick the wrong pattern by accident, and so a future migration of the raw-SQL modules has a target shape.

## Decision

**New modules use TypeORM by default.** Drop to raw SQL via `DatabaseService` only with stated justification (TypeORM can't satisfy the query, measured perf issue, or materially safer/more auditable as parameterized raw SQL). **Existing raw-SQL modules are NOT flagged for migration** — the new convention is forward-looking; established patterns continue working.

## Alternatives considered

- **All raw SQL.** Rejected: loses type safety, repetitive boilerplate per module, no first-class transaction helpers from the framework.
- **All TypeORM (force-migrate existing modules).** Rejected: large refactor with no immediate user-visible benefit; would smuggle structural change into unrelated PRs.
- **Both patterns at module author's discretion, no convention.** Rejected: produces inconsistency without a forcing function; no canonical place to look up "which way for this module".

## Consequences

- **Positive:** new modules get type-safe entities, framework-managed transactions, repository pattern by default. RBAC module ([src/modules/admin/rbac/infrastructure/persistence/](../../src/modules/admin/rbac/infrastructure/persistence/)) is the canonical example.
- **Negative:** mixed style across the codebase indefinitely. New contributors must understand both patterns until the raw-SQL modules are migrated.
- **Follow-ups:** when a raw-SQL module needs significant refactor anyway, that's the moment to consider migrating it to TypeORM. Until then, no forced migration. A future ADR will document the migration plan if/when it's planned.

## References

- [src/modules/admin/rbac/infrastructure/persistence/](../../src/modules/admin/rbac/infrastructure/persistence/) — canonical TypeORM example.
- [src/shared/database/database.service.ts](../../src/shared/database/database.service.ts) — raw-SQL fallback.
- `CLAUDE.md` § P2 — forward-looking convention statement.
- `.claude/skills/repo-conventions/SKILL.md` § "Stack" + § "Repository pattern" — enforcement detail.
- [`ADR-009`](./ADR-009-clean-architecture-layering-for-modules.md) — extends this ADR by mandating where the TypeORM repository lives in the layered module structure (`infrastructure/persistence/repositories/<aggregate>.typeorm-repository.ts` implementing a port defined in `domain/repositories/<aggregate>.repository.interface.ts`).
