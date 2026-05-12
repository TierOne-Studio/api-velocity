# ADR-004: NestJS built-in `Logger` — no pino, no structured logging, no request-id middleware

**Status:** Accepted
**Date:** 2026-04-30 (retroactively documented)
**Deciders:** core engineering team

## Context

Production Node.js logging best practice is structured JSON output (`pino` / `winston`) with request correlation IDs threaded through async context (`nestjs-cls`, `AsyncLocalStorage`). This makes logs machine-parseable, queryable in observability tooling, and traceable across services.

This repo has none of that. Application services use NestJS's built-in `Logger` (`new Logger(MyService.name)`) and emit human-readable text to stdout. There is no request-id middleware. Some legacy code paths still use `console.log` / `console.error`.

## Decision

Application services use `private readonly logger = new Logger(MyService.name)`. Sensitive fields are redacted manually before logging. No `pino`. No `nestjs-cls` / `AsyncLocalStorage` correlation. New code MUST prefer `Logger` over `console.*` (existing `console.*` usages are not flagged for migration).

## Alternatives considered

- **`nestjs-pino` + `nestjs-cls`.** Rejected: 2 npm dependencies + middleware + structural bootstrap change. Defer until an observability requirement (e.g., centralized log aggregation, distributed tracing) justifies the adoption. Captured as Approach B in `devops-use-logging.md`.
- **`winston` + custom request-id middleware.** Same as above, with no clear advantage over pino.
- **`console.*` everywhere.** Rejected: no log levels, no service tagging, indistinguishable from accidental debug output. The NestJS Logger is the floor.

## Consequences

- **Positive:** simpler; no new deps; no async-context plumbing. Log output is human-readable for local development.
- **Negative:** logs are not machine-parseable; no correlation across requests; sensitive-field redaction is manual and easy to miss.
- **Follow-ups:** if/when observability requirements emerge, adopt structured logging via `devops-use-logging.md` Approach B. Update this ADR's status to "Superseded".

## References

- `CLAUDE.md` § P2 — Logger convention restatement.
- `.claude/skills/repo-conventions/SKILL.md` § "Logger".
- `.claude/skills/nestjs-best-practices/rules/devops-use-logging.md` — Approach A (current repo) vs Approach B (pino+cls, asks-first).
- `.claude/skills/nestjs-best-practices/rules/di-scope-awareness.md` — `AsyncLocalStorage` Approach A vs `nestjs-cls` Approach B for correlation if needed standalone.
