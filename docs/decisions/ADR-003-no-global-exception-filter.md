# ADR-003: No global exception filter — throw NestJS built-ins

**Status:** Accepted
**Date:** 2026-04-30 (retroactively documented)
**Deciders:** core engineering team

## Context

NestJS supports global exception filters via `app.useGlobalFilters(new AllExceptionsFilter(...))` or `APP_FILTER`. Many production NestJS apps adopt this for centralized error envelope shaping, structured logging on errors, and custom domain exceptions.

This repo currently has no global filter. Errors are thrown as NestJS built-in exceptions (`NotFoundException`, `ForbiddenException`, `BadRequestException`, `HttpException`) and the framework's default exception handler maps them to HTTP responses.

## Decision

Controllers and request-lifecycle services throw NestJS built-in exceptions. **No global `AllExceptionsFilter`.** **No custom `AppError` hierarchy.** Adopting a global filter is a structural decision (P3.5) — not a side-effect of unrelated work.

## Alternatives considered

- **Global `AllExceptionsFilter` + custom domain exceptions.** Rejected: adds infrastructure for marginal gain at current scale. Existing routes already produce coherent error envelopes via the default handler. Adopting later is an option (see `error-use-exception-filters.md` Approach B) once the repo has structured-logging requirements that justify the filter.
- **Per-controller filters.** Rejected: duplication; loses the central-policy benefit that motivates filters in the first place.
- **Plain `Error(...)` from services.** Rejected: produces opaque 500s with no client-actionable context. NestJS built-ins are the floor.

## Consequences

- **Positive:** less infrastructure code; standard NestJS error envelope is sufficient; new contributors don't need to learn a custom error hierarchy.
- **Negative:** error logging is decentralized (each service logs what it throws); response shape is the NestJS default, which may not satisfy clients that want richer context (e.g., `code` field, correlation ID).
- **Follow-ups:** if observability or richer error contracts become a requirement, adopt a global filter as a focused PR (per `error-use-exception-filters.md` Approach B adoption checklist). Update this ADR's status to "Superseded by ADR-NNN".

## References

- `CLAUDE.md` § P2 — error-handling restatement.
- `.claude/skills/repo-conventions/SKILL.md` § "Error handling".
- `.claude/skills/nestjs-best-practices/rules/error-use-exception-filters.md` — P3.5 Approach A vs Approach B framing.
