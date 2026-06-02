# Architecture Decision Records (ADRs)

This directory captures **load-bearing engineering decisions** for `api-velocity`. Each ADR records the *why* behind a choice that, if changed, would force a structural refactor or behavior change across the codebase.

## What goes here

ADRs document decisions where:
- The choice is **non-obvious** (multiple credible alternatives existed).
- The choice **constrains future code** (refactoring out of it is expensive).
- The choice **is referenced repeatedly** in `CLAUDE.md`, `repo-conventions`, or skill files.

If a decision is fully captured by a one-line repo convention and never needs justification, it does NOT need an ADR.

## What does NOT go here

- Routine implementation notes (those belong in commit messages or the relevant module's README).
- Style/formatting rules (that's `.editorconfig` / `.prettierrc`).
- Reversible local choices (variable names, internal helper shape, etc.).
- Anything that changes weekly.

## Format

Use [`_template.md`](./_template.md) as the starting point. Numbered sequentially: `ADR-NNN-short-kebab-title.md`. Once accepted, ADRs are **append-only** — superseded ADRs get `Status: Superseded by ADR-XXX` and stay in place. Don't edit history.

## How skills/agents reference ADRs

When a skill or subagent enforces an ADR-backed convention, it MUST cite the ADR by number, not restate the rationale:

> ✅ "Per `ADR-003`, throw NestJS built-in exceptions; no global filter."
> ❌ "Don't add a global filter. The repo doesn't have one because adding one would..."

This keeps skill files focused on *how* and the ADR file as the canonical *why*.

## Index

| # | Title | Status | Date |
|---|---|---|---|
| [001](./ADR-001-typeorm-first-persistence.md) | TypeORM-first persistence with raw-SQL fallback | Accepted | 2026-04-30 |
| [002](./ADR-002-rbac-scope-all-returns-400.md) | RBAC `scope=all` by non-superadmin returns 400, not 403 | Accepted | 2026-04-30 |
| [003](./ADR-003-no-global-exception-filter.md) | No global exception filter — throw NestJS built-ins | Accepted | 2026-04-30 |
| [004](./ADR-004-nestjs-logger-no-pino.md) | NestJS built-in `Logger` — no pino, no structured logging, no request-id middleware | Accepted | 2026-04-30 |
| [005](./ADR-005-no-class-validator-no-validation-pipe.md) | No `class-validator` and no global `ValidationPipe` | Accepted | 2026-04-30 |
| [006](./ADR-006-asks-first-dep-gate.md) | Asks-first dependency gate (Approach A vs Approach B per rule) | Accepted | 2026-04-30 |
| [007](./ADR-007-skill-vs-repo-conflict-resolution.md) | Skill-vs-repo conflict resolution (P3.5) — skill default, repo wins on structural | Accepted | 2026-04-30 |
| [008](./ADR-008-no-ai-attribution.md) | No AI-attribution trailers in commits, PRs, issues, or releases | Accepted | 2026-04-30 |
| [009](./ADR-009-clean-architecture-layering-for-modules.md) | Clean architecture / hexagonal layering for new modules (extends ADR-001) | Accepted | 2026-04-30 |
| [010](./ADR-010-supersede-app-db-host-guard.md) | Supersede the host+port app-DB guard; rely on the read-only contract | Accepted | 2026-05-19 |
| [011](./ADR-011-airweave-ownership-via-org-metadata.md) | Airweave collection ownership via `organization.metadata` allowlist | Accepted | 2026-05-23 |
| [012](./ADR-012-sql-connection-permission-family.md) | SQL connection permission family and backwards-compatible grant inheritance | Accepted | 2026-05-27 |
| [013](./ADR-013-vector-db-persistence-lifecycle.md) | Vector DB module — persistence, provider abstraction, and lifecycle | Accepted | 2026-06-02 |

## Adding a new ADR

1. Copy `_template.md` to `ADR-NNN-short-title.md` (next available number).
2. Fill in Status / Date / Context / Decision / Alternatives / Consequences / References.
3. Add a row to the index table above.
4. Update any skill or `CLAUDE.md` section that previously contained the rationale to **cite the ADR** instead.
5. Commit with message `docs(adr): ADR-NNN <title>`.

ADRs are tracked via the `documentation-and-adrs` skill (loads when proposing or referencing a load-bearing decision).
