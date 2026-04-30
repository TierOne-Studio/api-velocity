# ADR-007: Skill-vs-repo conflict resolution (P3.5) — skill default, repo wins on structural

**Status:** Accepted
**Date:** 2026-04-30
**Deciders:** core engineering team

## Context

This repo loads `.claude/skills/nestjs-best-practices` (40 rules of generic NestJS best practices) alongside `.claude/skills/repo-conventions` (api-velocity-specific facts). The two sometimes conflict:

- The skill recommends a global `AllExceptionsFilter`; the repo has none.
- The skill recommends `APP_GUARD` global registration; the repo applies guards per-route.
- The skill recommends `class-validator` + `ValidationPipe`; the repo uses helper functions.

Without a meta-rule, the model picks ad-hoc — sometimes following the skill (and smuggling structural changes into unrelated PRs), sometimes following the repo (and ignoring valid best-practice guidance).

## Decision

**Default: follow the skill recommendation.** Skills are the team's curated best-practice catalog and are the default source for situational guidance.

**Exception — structural refactor.** If applying the skill would force ANY of:

- Installing a new dependency.
- Adding cross-cutting infrastructure the repo lacks (global exception filter, global ValidationPipe, app-wide logger swap, request-id middleware, CLS).
- Modifying app-wide bootstrap or `main.ts`.
- Refactoring established patterns in modules unrelated to the current change.

…then **follow `repo-conventions` / `CLAUDE.md` for the current PR**, AND recommend the skill's pattern as a Future task in the response's Optional Improvements section.

**The test:** would applying this best practice change code outside the current PR's scope? If yes → repo wins, recommend future task. If no → skill wins, apply now.

## Alternatives considered

- **Always-skill (skill wins unconditionally).** Rejected: structural refactors smuggle into unrelated PRs; scope discipline collapses; PR diffs balloon with "while we're here" infrastructure changes.
- **Always-repo (repo wins unconditionally).** Rejected: repository never adopts new best practices; new modules forever inherit pre-existing patterns even when better alternatives exist.
- **No meta-rule, decide case-by-case.** Rejected: produces inconsistency and bikeshedding. Each PR re-litigates the same question.

## Consequences

- **Positive:** consistent rule across CLAUDE.md, all 4 review subagents (`code-reviewer`, `architect-reviewer`, `qa-validator`, `security-reviewer`), `decision-rules` § 6, and the 11 catalogued rules in `nestjs-best-practices`. PR scope stays tight; structural changes get their own focused PR with regression coverage.
- **Negative:** "structural" requires judgment; the rule is not mechanical. Edge cases need to be argued per-PR ("does refactoring this one helper count?").
- **Follow-ups:** `architect-reviewer` flags structural-scope-creep as HIGH; `code-reviewer` flags unflagged structural changes as MED; `security-reviewer` carries an explicit override (HIGH/CRITICAL security gaps with only-structural fix BLOCK rather than defer).

## References

- `CLAUDE.md` § P3.5 — canonical statement.
- `.claude/skills/decision-rules/SKILL.md` § 6 — decision-rule mirror of P3.5.
- `.claude/agents/architect-reviewer.md`, `code-reviewer.md`, `qa-validator.md`, `security-reviewer.md` — all four cite P3.5.
- `.claude/skills/nestjs-best-practices/rules/error-use-exception-filters.md` — canonical example of P3.5 applied to a non-dep structural conflict.
- `ADR-006` — asks-first dep gate (subset of P3.5 scoped to dependency installs).
