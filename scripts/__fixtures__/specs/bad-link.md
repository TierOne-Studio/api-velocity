---
id: SPEC-902
title: "SPEC-902: Fixture with malformed counterpart"
status: Implemented
layer: ui
owner: Test
created: 2026-06-03
updated: 2026-06-03
feature_paths:
  - src/features/Fixture
related_adrs: []
related_specs: []
counterpart_spec: "apivelocity SPEC 7"
coordination_doc: ""
---

# SPEC-902: Fixture with malformed counterpart

## 1. Summary
Complete content, but `counterpart_spec` is malformed — fails the links lint.

## 2. Context & problem
Exercises the links lint format check.

## 3. Scope
In scope: nothing.

## 4. Assumptions
1. [Confirmed] none.

## 5. Affected areas
- src/features/Fixture

## 6. Acceptance criteria
| # | Criterion | Test |
|---|---|---|
| AC1 | fails links lint | this fixture |

## 7. Implementation plan
1. none.

## 8. Testing plan
Lints only.

## 9. Risks & failure modes
None.

## 10. Open questions
None.

## Change Log
- 2026-06-03 · PR test · created · fixture.
