---
name: documentation-and-adrs
description: Use when proposing a new load-bearing engineering decision (one that constrains future code or is referenced repeatedly across CLAUDE.md/skills/conventions), when superseding an existing decision, OR when a skill/CLAUDE.md section is about to restate the rationale behind an existing decision (cite the ADR instead). NOT for routine implementation, style/formatting choices, reversible local choices, or notes that belong in commit messages.
---

# Documentation and ADRs

Architecture Decision Records (ADRs) are the canonical *why* for the repo. Skills and `CLAUDE.md` are the *what* and *how* — they cite ADRs rather than restate rationales.

## When this skill fires

- A user asks to make a structural choice that will constrain future code (persistence pattern, error-mapping convention, auth library, public-API contract shape).
- A skill or CLAUDE.md edit is about to add/expand a paragraph explaining why a convention exists. Stop — that paragraph should live in an ADR; the skill should cite it.
- An existing decision is being reversed or superseded.
- The user asks "why do we do X" and the answer isn't in `docs/decisions/`.

## When this skill does NOT fire

- Routine implementation work (file naming, internal helper shape, variable names).
- Style/formatting (those go in `.editorconfig` / `.prettierrc`).
- One-off bug fixes.
- Decisions reversed by the next sprint (ADRs are for durable choices).

## Format

ADRs live in [`docs/decisions/`](../../docs/decisions/). Use [`_template.md`](../../docs/decisions/_template.md) as the starting point. Numbered sequentially: `ADR-NNN-short-kebab-title.md`.

Each ADR contains:

- **Status** — Proposed / Accepted / Deprecated / Superseded by ADR-XXX.
- **Date** — when the ADR was written (not when the decision was made, if retrospective).
- **Context** — forces at play; cite specific files where the constraint is visible.
- **Decision** — 1–3 sentences. State as a rule the codebase follows.
- **Alternatives considered** — at least one realistic alternative + why rejected.
- **Consequences** — positive / negative / follow-ups.
- **References** — source files, skills, CLAUDE.md sections, related ADRs.

ADRs are **append-only**. Don't edit accepted ADRs except to update Status (Accepted → Superseded by ADR-XXX). The next ADR explains why.

## How to cite ADRs from skills, CLAUDE.md, subagents

When a skill or convention enforces an ADR-backed rule, MUST cite the ADR by number, not restate the rationale:

> ✅ "Per `ADR-003`, throw NestJS built-in exceptions; no global filter."
> ❌ "Don't add a global filter. The repo doesn't have one because adding one would..."

Skill content stays focused on *how to do it correctly today*. The ADR file holds *why this is the rule and what was rejected*.

## Workflow when proposing a new ADR

1. **Confirm it's load-bearing.** If the decision doesn't constrain future code or get cited from at least one skill / CLAUDE.md section, it doesn't need an ADR. A commit message or repo-conventions bullet may be enough.
2. **Copy the template:** `cp docs/decisions/_template.md docs/decisions/ADR-NNN-<short-kebab-title>.md`. NNN is the next available number (check the index in `docs/decisions/README.md`).
3. **Fill it in.** Be specific. "We chose X because Y, and rejected A, B, C." Avoid hedge words.
4. **Add a row to the index table** in `docs/decisions/README.md`.
5. **Update the citation surface.** Any skill or `CLAUDE.md` section that previously contained the rationale gets shortened to cite the ADR (`Per ADR-NNN, ...`).
6. **Commit:** `docs(adr): ADR-NNN <title>`. ADRs do NOT need TDD — they're documentation. The `tdd-workflow` skill explicitly waives docs.

## Workflow when superseding an ADR

1. Mark the existing ADR's Status: `Superseded by ADR-XXX`. Do NOT delete or rewrite the body.
2. Write the new ADR. Include a `Supersedes ADR-NNN` line in its References section, plus a brief Context note explaining what changed since the prior decision.
3. Update the citation surface (skills, CLAUDE.md) to point at the new ADR.
4. Commit: `docs(adr): ADR-XXX supersedes ADR-NNN — <reason>`.

## Anti-patterns

- **Inline rationale in skills.** A skill paragraph longer than ~3 sentences explaining *why* a convention exists is a smell — that content belongs in an ADR.
- **Editing accepted ADRs.** Append-only. Status-line updates are the only allowed edit.
- **ADRs for ephemeral decisions.** "Use 4-space indentation" is `.editorconfig`, not an ADR. "We use a session model not JWTs" is an ADR.
- **Single-alternative ADRs.** "There was no other option" is rarely true. If you can't name an alternative, you haven't thought hard enough.
- **Decision-without-context ADRs.** "We use TypeORM" is not an ADR — it's a sentence. The Context section is what makes it readable in 12 months.

## Cross-references

- `repo-conventions` — captures the *what* (the rule itself); ADRs capture the *why*. Conventions cite ADRs.
- `plan-mode` — when planning a change that proposes a new structural decision, the plan should name the ADR-to-be-written as a step.
- `decision-rules` § 6 / `CLAUDE.md` P3.5 — the meta-rule under which most structural decisions get framed.

## References

- [docs/decisions/README.md](../../docs/decisions/README.md) — index of accepted ADRs.
- [docs/decisions/_template.md](../../docs/decisions/_template.md) — starting template.
