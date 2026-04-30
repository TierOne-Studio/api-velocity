# ADR-005: No `class-validator` and no global `ValidationPipe`

**Status:** Accepted
**Date:** 2026-04-30 (retroactively documented)
**Deciders:** core engineering team

## Context

NestJS documentation recommends defining DTOs as classes annotated with `class-validator` decorators (`@IsString()`, `@IsEmail()`, etc.) and registering a global `ValidationPipe` that automatically rejects requests with invalid bodies. This is the dominant NestJS pattern in tutorials and many production codebases.

This repo does none of that. DTOs are plain TypeScript types/interfaces (no decorator metadata). Validation happens at controller/service boundaries via small helper functions (`requireString`, `requireUuid`, `requireInt`, `requireEmail`). There is no global `ValidationPipe` in `main.ts`.

## Decision

DTOs are TypeScript types or interfaces — no `class-validator` decorators. Validation is **explicit at boundaries** via helper functions. No global `ValidationPipe`. Adopting class-validator is a structural change (asks-first, P3.5).

## Alternatives considered

- **`class-validator` + `class-transformer` + global `ValidationPipe`.** Rejected: 2 dependencies + global pipe + decorator-metadata reflection. Captured as Approach B in `security-validate-all-input.md`. Adoption is justified only when validation surface is large enough that helper-function repetition outweighs the dep cost.
- **`zod`.** Rejected for the same reason — a new dep with structural impact (where to wire schemas, how to share them between request validation and response shaping).
- **No validation at all, trust the type system.** Rejected: types are erased at runtime; client input is untrusted.

## Consequences

- **Positive:** validation is visible in the controller/service code, not hidden behind decorator magic. DTOs are usable as plain types in tests. No reflection metadata (`reflect-metadata`) coupling beyond what NestJS already requires.
- **Negative:** validation helpers must be maintained manually; missing-validation bugs are possible (the type system can't catch a forgotten `requireString` call). Helper coverage must grow as new field shapes appear.
- **Follow-ups:** if the validation surface grows past the point where helpers are maintainable (rough threshold: ~50+ DTOs with rich validation rules), adopt `class-validator` via `security-validate-all-input.md` Approach B and update this ADR's status.

## References

- `CLAUDE.md` § P2 — DTO convention.
- `.claude/skills/repo-conventions/SKILL.md` § "DTOs".
- `.claude/skills/nestjs-best-practices/rules/security-validate-all-input.md` — Approach A (helpers) vs Approach B (class-validator, asks-first).
