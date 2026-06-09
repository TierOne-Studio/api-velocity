# Feature Specifications (SPECs)

Durable *what + how* for api-velocity's features and behavioral changes. A SPEC is the
**source of truth for intended behavior**: created/updated **before** code and reconciled
with what shipped **after**. The `spec-steward` agent owns this folder; the `spec-workflow`
skill carries the full procedure.

**Layer:** this repo holds **`contract`** specs (entities, endpoints, DTOs, RBAC, migrations).
The paired **`ui`** specs (screens, forms, validation, UX) live in `spa-velocity/docs/specs/`.
A cross-cutting feature has one spec per layer, cross-linked via the `counterpart_spec`
frontmatter field. See `cross-repo-workspace` Rule 8 for the rule.

**SPEC vs ADR vs plan:** a SPEC is *what we build + how* (this folder). An **ADR**
(`docs/decisions/`) is *why a load-bearing decision was made*; SPECs cite ADRs, they do not
restate rationale. `plan-mode` is ephemeral execution sequencing, persisted *into* the SPEC.

## Index

| # | Title | Status | Updated | Feature paths |
|---|---|---|---|---|
| [SPEC-000](SPEC-000-specification-first-workflow.md) | Specification-first workflow | Draft | 2026-06-04 | .ruler, docs/specs, scripts |
| [SPEC-001](SPEC-001-vector-db-knowledge-base-rag.md) | Vector DB Knowledge Bases + RAG retrieval | Draft | 2026-06-09 | src/modules/vector-db |

## Status lifecycle

`Draft` → (`Approved`) → `Implemented` → `Superseded by SPEC-XXX`

- `Draft` — written before code, under review.
- `Approved` — signed off but implementation deferred to a later PR (skip when implementing immediately).
- `Implemented` — merged; reconciled with what shipped.
- `Superseded by SPEC-XXX` — replaced; body kept, not deleted.

## Creating a SPEC

1. **Search first** (this index + a grep of `docs/specs/`). One SPEC per feature/capability — never two.
2. **Resolve ambiguity** — ask the user any material clarifying questions *before* writing (see `spec-workflow`). Do not guess past a material ambiguity.
3. `cp docs/specs/_template.md docs/specs/SPEC-NNN-<short-kebab-title>.md` where `NNN` is the next free number.
4. Fill it in. Acceptance criteria must be falsifiable and each map to a test. No `TBD`/placeholder in a load-bearing section before it leaves `Draft`. If an entity changes, a migration ships in the same change.
5. If the change makes a load-bearing decision, also write/cite an ADR (`documentation-and-adrs`).
6. Add a row to the index above.
7. For a cross-cutting change, create/update the paired spec in `spa-velocity/docs/specs/`, set `counterpart_spec` on both, and write a coordination doc.

## Updating a SPEC (the default for any existing feature)

Update the existing SPEC — never open a second — when improving/extending a feature, fixing a
bug that changes intended behavior, making a follow-up change, refactoring with a behavior change,
or correcting a wrong assumption. Append a Change Log entry every time.

## Exemptions (the only valid skips)

State the exact phrase, mirroring `tdd-workflow` waivers:

```
SPEC waived — non-code change.
SPEC waived — type-only.
SPEC waived — config change with no behavior impact.
```

"small change", "obvious fix", "trivial", "just a refactor" are NEVER valid skips.
