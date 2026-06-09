---
id: SPEC-NNN
title: "SPEC-NNN: <Human Title>"
status: Draft            # Draft | Approved | Implemented | Superseded by SPEC-XXX
layer: contract          # contract (api-velocity) | ui (spa-velocity)
owner: <name>
created: YYYY-MM-DD
updated: YYYY-MM-DD
feature_paths:           # source of truth this spec governs (this repo)
  - src/modules/<Module>
related_adrs: []         # e.g. [ADR-001]
related_specs: []        # same-repo siblings, e.g. [SPEC-002]
counterpart_spec: ""     # paired spec in the OTHER repo, e.g. "spa-velocity#SPEC-002"; "standalone" if none
coordination_doc: ""     # for cross-repo changes, e.g. "docs/<feature>-coordination-plan.md"
---

# SPEC-NNN: <Human Title>

## 1. Summary (intended behavior)

One paragraph: what the API/domain should do after this change.

## 2. Context & problem

Why this change exists — the need/incident/request that prompted it. What's wrong or
missing today. Cite files where the constraint is visible.

## 3. Scope

**In scope:** <bullets>

**Out of scope / non-goals:** <bullets — explicit, so reviewers don't expect them>

## 4. Assumptions

Numbered; each gets a status. Wrong ones are struck and corrected in place.

1. [Confirmed|Unconfirmed|Corrected] <assumption>
2. ...

> Correct any Unconfirmed assumption now, or implementation proceeds on it.

## 5. Affected areas

Entities / relationships / endpoints / DTOs / RBAC scopes / migrations / modules. Keep aligned with the real diff.

- `src/modules/<Module>/...`
- Endpoints: ...
- Entities + migration: ...
- RBAC scopes: ...

## 6. Acceptance criteria (falsifiable; each maps to a test)

| # | Criterion (observable behavior) | Proving test (file:line) |
|---|---|---|
| AC1 | <e.g. "Returns 403 when caller's scope excludes the org"> | <jest spec / e2e path> |
| AC2 | ... | ... |

## 7. Implementation plan

3–8 steps (mirrors plan-mode). Each: `files:` / `tests:` / `risk:` / `slice:`.
If an entity changes, a migration MUST ship in the same change.

## 8. Testing plan

Which layer proves which AC — Jest unit (`*.spec.ts`), e2e (`test/*.e2e-spec.ts`).
Name the test files.

## 9. Risks & failure modes

Null/empty/large/race/partial/transaction-rollback/constraint-violation/boundary as relevant; mitigation per risk.

## 10. Open questions

Unresolved items blocking or shaping the work.

## Change Log

Append-only. Newest first.

- YYYY-MM-DD · PR #NN · <what changed> · <why> · (assumption corrections, if any)
