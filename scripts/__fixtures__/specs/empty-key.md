---
id: SPEC-906
title: "SPEC-906: Fixture empty frontmatter key"
status: Implemented
layer: ui
owner:
created: 2026-06-04
updated: 2026-06-04
feature_paths:
  - src/features/Fixture
related_adrs: []
related_specs: []
counterpart_spec: "standalone"
coordination_doc: ""
---

# SPEC-906: Fixture empty frontmatter key

## 1. Summary
`owner:` is empty in the frontmatter — completeness must FAIL on the empty required key.

## 2. Context & problem
Covers the empty-frontmatter-key failure branch.

## 3. Scope
In scope: nothing.

## 4. Assumptions
1. [Confirmed] none.

## 5. Affected areas
- src/features/Fixture

## 6. Acceptance criteria
| # | Criterion | Test |
|---|---|---|
| AC1 | empty owner fails completeness | this fixture (expect FAIL) |

## 7. Implementation plan
1. none.

## 8. Testing plan
Lints only.

## 9. Risks & failure modes
None.

## 10. Open questions
None.

## Change Log
- 2026-06-04 · PR test · created · fixture.
