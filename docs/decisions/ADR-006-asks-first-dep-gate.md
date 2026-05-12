# ADR-006: Asks-first dependency gate (Approach A vs Approach B per rule)

**Status:** Accepted
**Date:** 2026-04-30
**Deciders:** core engineering team

## Context

The `nestjs-best-practices` skill in `.claude/skills/` is a 40-rule catalog of NestJS production patterns. Many of those rules originally prescribed third-party libraries (`nestjs-pino`, `class-validator`, `@nestjs/event-emitter`, `nestjs-cls`, `@nestjs/config`, `dataloader`, `@nestjs/terminus`, `helmet`, `sanitize-html`, `@keyv/redis`, `@nestjs/cache-manager`, `@nestjs/bullmq`).

Most of these libraries are NOT installed in this repo. A naive agent reading the rule could copy the example code and silently introduce a new dependency, bypassing CLAUDE.md P0.2/P0.3 (package installs require explicit user approval).

A structural fix was needed: rules must ask before installing, and where possible offer a no-deps alternative.

## Decision

Every rule that recommends a third-party library MUST present:

- **Approach A — Custom abstraction (no new deps)** — a lightweight in-repo implementation of the rule's outcome. Used as the default.
- **Approach B — Library (requires installing `<pkg>`)** — the library-backed implementation, marked as adoption-gated.

Plus an **Approach gate** section that instructs the agent to ASK the user which approach to use BEFORE writing code.

For rules where no clean abstraction exists (Tier 3, e.g., `micro-use-queues` requires Redis + a queue runtime), the rule presents only the library approach but MUST ask before installing.

For rules where the conflict is structural rather than dep-driven (e.g., `error-use-exception-filters` recommends a global filter that the repo doesn't have, `security-use-guards` recommends `APP_GUARD` global registration), the rule applies P3.5 framing: default to existing repo pattern, adoption is structural and asks-first.

11 rules currently document this structure explicitly. Future dep-prescribing rules MUST follow the same shape.

## Alternatives considered

- **Allow rules to silently prescribe libraries.** Rejected: violates CLAUDE.md P0.2/P0.3, produces dep installs without user approval, and degrades trust in the skill catalog.
- **Forbid all library recommendations in rules.** Rejected: too restrictive — some libraries are genuinely the right answer once the use case justifies them (e.g., bullmq for queues). The point is to gate adoption, not forbid it.
- **Add disclaimers without changing structure.** Rejected: disclaimers don't change behavior. The Approach A vs Approach B framing forces the agent to make the choice explicit.

## Consequences

- **Positive:** zero silent dep installs. Custom abstractions are documented and ready to copy. Library adoption becomes a deliberate decision with an audit trail.
- **Negative:** rule files are longer (~2× original size). Maintaining two parallel approaches per rule has a small ongoing cost. Custom abstractions may diverge in capability from the library equivalents over time.
- **Follow-ups:** `security-reviewer` Step 2.5 dep-gate audit enforces the rule post-hoc by detecting new `package.json` entries without an `Awaiting approval` evidence trail. Acceptance assertions T61 / T63 / T65 verify the structure stays wired.

## References

- `.claude/skills/nestjs-best-practices/SKILL.md` § "How rules in this skill are structured" — prelude documenting the convention with the 11-rule table.
- `.claude/agents/security-reviewer.md` § "Step 2.5 Dependency-gate audit" — post-hoc enforcement.
- `.claude/tests/run-acceptance.sh` T61, T63, T65 — structural assertions.
- `ADR-007` — the broader skill-vs-repo conflict resolution rule (P3.5) under which this dep-gate operates.
