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

## Layered-router principle (CLAUDE.md is pure routing)

**The rule:** CLAUDE.md is the always-loaded router. It MUST NOT reference Layer-3 artifacts. Skills and subagents own all artifact citations. Adding a new artifact is normal repo growth; the always-loaded router does NOT grow with it.

**CLAUDE.md MAY reference:**

- Skills by name (e.g., `repo-conventions`, `tdd-workflow`).
- Subagents by name (e.g., `architect-reviewer`).
- Other CLAUDE.md sections by P-number (e.g., "see P3.4").
- Literal command tokens that ARE the rule (e.g., `git push`, `INSERT`, `Co-Authored-By: Claude` — strings the rule literally matches at the tool boundary).
- Domain category names (auth, RBAC, payments, PII — concepts, not artifacts).
- Output structural labels (`Skills consulted:`, `Confidence:` — response markers the contract enforces).

**CLAUDE.md MUST NOT reference:**

- ADR numbers (`ADR-001`, `ADR-002`, ...) — those live in `repo-conventions` § "ADR-backed conventions" + `docs/decisions/README.md`.
- File paths (`src/...`, `docs/...`, `.claude/skills/...`) — those live in skill/subagent files.
- Code symbols, decorators, class names, function names (`@RequirePermissions`, `PermissionsGuard`, `@InjectRepository`, `resolveOrgScope`, etc.) — those live in skills with patterns + examples.
- Subagent internal step numbers (`code-reviewer Step 5`) — those are subagent implementation detail.

**Where every new artifact gets cited (single-source-of-truth flow):**

For a new ADR:

1. The ADR file: `docs/decisions/ADR-NNN-<title>.md`.
2. Index row: `docs/decisions/README.md`.
3. Citation site (depending on type):

   | ADR type | Citation site |
   |---|---|
   | Convention (persistence, error-handling, logging, DTOs, layering) | `repo-conventions` § "ADR-backed conventions" table |
   | Meta-rule (conflict resolution, asks-first, attribution) | The relevant skill (`decision-rules` § 6, `nestjs-best-practices` prelude, `git-workflow` Hard rules) |
   | Subagent behavior (review-time enforcement) | The relevant subagent's Required Reading + audit step |

4. **CLAUDE.md is NEVER updated** for new ADRs. The router doesn't track artifacts.

For a new skill: add Skill Pointers row + (if part of a recipe) Workflow chains row in CLAUDE.md. Skill itself owns description, when-to-use, patterns, examples, ADR citations, code symbols.

For a new subagent: add to P4 verification matrix in CLAUDE.md if it's a review subagent. Subagent itself owns all process detail.

**Enforcement:** acceptance test T74 fails if CLAUDE.md gains an `ADR-NNN`, `docs/decisions/`, or `src/<dir>/` reference. `meta-skill-hygiene` audit check 7 catches drift. Both architect-reviewer and code-reviewer flag CLAUDE.md edits that introduce artifact citations as MED.

**The "load-bearing exception" was retired.** Earlier versions of CLAUDE.md kept code-symbol primers in P2 (RBAC, org-scoping) on the theory that they were always-on safety nets. We retired this in favor of broadening `repo-conventions` description so the skill auto-loads on architecture discussions too. Don't reintroduce inline symbols in CLAUDE.md without superseding this section.

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
