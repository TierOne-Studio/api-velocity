---
id: SPEC-000
title: "SPEC-000: Specification-first workflow"
status: Draft
layer: contract
owner: Mariano Ravinale
created: 2026-06-04
updated: 2026-06-04
feature_paths:
  - .ruler/skills/spec-workflow
  - .ruler/agents/spec-steward.md
  - .ruler/instructions.md
  - docs/specs
  - scripts
related_adrs: [ADR-013]
related_specs: []
counterpart_spec: "spa-velocity#SPEC-000"
coordination_doc: "docs/spec-first-workflow-proposal.md"
---

# SPEC-000: Specification-first workflow

> The `contract`-layer counterpart of `spa-velocity#SPEC-000`. Full design + rationale lives in
> the spa-velocity proposal; this SPEC governs the api-velocity install.

## 1. Summary (intended behavior)

Every **behavioral** code change in api-velocity must create/update a Markdown SPEC (this folder,
layer `contract`) before implementation, and reconcile it with what shipped after — enforced by a
hard CI `spec-gate`, deterministic lints, and the `spec-steward` agent.

## 2. Context & problem

The LLM jumped straight to code, leaving no SPEC/PRD history, stale docs after fixes, undocumented
or wrong assumptions, and code↔doc drift. See spa-velocity's proposal §1.

## 3. Scope

**In scope (this repo, layer `contract`):** `docs/specs/` scaffolding; `spec-workflow` skill;
`spec-steward` agent (write-capable, scoped to `docs/specs/**`); router edits (P3.0 / P3.4 / P4 /
P8.0); CI `spec-gate` + lints (NestJS globs); harness self-test extensions; ADR-013; T13 ceiling
raised to 3850 (pre-existing CLAUDE.md overage + spec-first headroom).

**Out of scope / non-goals:** feature backfill (separate PRs); the OpenAPI machine-link
(deferred — ci-gates Phase C); spa-velocity's own install (its `ui` SPEC-000).

## 4. Assumptions

1. [Confirmed] Harness is Ruler-generated: `.ruler/*` → `.claude/*` / `CLAUDE.md` via `npx ruler apply`.
2. [Confirmed] api uses `docs/decisions/` for ADRs (001–012 exist); next free is ADR-013. (`docs/adr/` holds one legacy 4-digit file — untouched.)
3. [Confirmed] api's `run-acceptance.sh` differs from spa's (T13 word gate on generated CLAUDE.md; `tools_for_agent` helper; distinct T-numbering) — self-test edits adapted, not copied.
4. [Confirmed] api's T13 gate (CLAUDE.md ≤ 3350) was already failing on master (3704). Raised to 3850 per user decision.
5. [Confirmed] NestJS behavioral source = `src/**/*.ts` excluding `*.spec.ts`/`*.e2e-spec.ts`/`*.d.ts`.

## 5. Affected areas

- `docs/specs/{README.md,_template.md,SPEC-000-*.md}`
- `.ruler/skills/spec-workflow/SKILL.md`, `.ruler/agents/spec-steward.md`, `.ruler/instructions.md` (P3.0/P3.4/P4/P8.0)
- `scripts/spec-gate.sh` (NestJS globs) + `spec-complete-check.sh` + `spec-links-check.sh`
- `.github/workflows/spec-gate.yml` (PR to master)
- `.ruler/tests/run-acceptance.sh` (spec files, spec-workflow, spec-steward + write-capable/no-leak, P3.0, T13→3850)
- `docs/decisions/ADR-013-spec-first-documentation-workflow.md` + `docs/decisions/README.md`

## 6. Acceptance criteria (falsifiable; each maps to a test)

| # | Criterion (observable behavior) | Proving test |
|---|---|---|
| AC1 | Behavioral `src/**/*.ts` change without a `docs/specs/**` change fails the gate | `scripts/spec-gate.sh` fixture (negative) |
| AC2 | Same diff + a spec change passes | `scripts/spec-gate.sh` fixture (positive) |
| AC3 | `[skip-spec: type-only]` waiver passes | `scripts/spec-gate.sh` fixture (waiver) |
| AC4 | Placeholder/empty-section spec fails completeness | `scripts/spec-complete-check.sh` fixture |
| AC5 | Unresolved `counterpart_spec`/`related_specs` fails links | `scripts/spec-links-check.sh` fixture |
| AC6 | Generated CLAUDE.md has P3.0 + P3.4/P4 rows + P8.0 clause | `run-acceptance.sh` assertions |
| AC7 | `spec-steward` present + write-capable; no other agent gained Edit/Write | `run-acceptance.sh` agent loop + write-capable assertion |
| AC8 | `npm run test:claude` green after `npx ruler apply` (T13 ≤ 3850) | `run-acceptance.sh` + `simulate-prompts.sh` |

## 7. Implementation plan

Slicing: **risk-first**. 1) scaffolding; 2) gate+lints+CI+self-test (NestJS); 3) skill+agent;
4) router → ruler apply → test:claude; 5) ADR-013 + cross-repo Rule 8/ENFORCE-5. `slice:` per step.

## 8. Testing plan

Deterministic core: `bash scripts/*.sh` vs committed fixtures. Harness: `npm run test:claude`.
No app-runtime layer (this touches the harness, not app code).

## 9. Risks & failure modes

- Gate false-positives on non-behavioral `.ts` → the three `[skip-spec:…]` tokens.
- CLAUDE.md word budget → T13 raised to 3850; keep P3.0 terse.
- Write-capable agent leaks beyond `docs/specs/**` → mechanical no-leak guard in run-acceptance.sh.
- ADR-013 is the next free number (012 is the latest on master).

## 10. Open questions

None open (assumption #2/#4 resolved by inspection + user decision).

## Change Log

- 2026-06-04 · PR (pending) · api install of the spec-first workflow (layer contract); T13 raised 3350→3850 · mirrors spa-velocity#SPEC-000.
