---
id: SPEC-900
title: "SPEC-900: Fixture good"
status: Implemented
layer: ui
owner: Test
created: 2026-06-03
updated: 2026-06-03
feature_paths:
  - src/features/Fixture
related_adrs: []
related_specs: []
counterpart_spec: "standalone"
coordination_doc: ""
---

# SPEC-900: Fixture good

## 1. Summary
A complete, valid fixture spec.

## 2. Context & problem
Exercises the completeness and links lints with a passing case.

## 3. Scope
In scope: nothing real. Out of scope: everything.

## 4. Assumptions
1. [Confirmed] none.

## 5. Affected areas
- src/features/Fixture

## 6. Acceptance criteria
| # | Criterion | Test |
|---|---|---|
| AC1 | passes both lints | this fixture |

## 7. Implementation plan
1. none. slice: 0.

## 8. Testing plan
Lints only.

## 9. Risks & failure modes
None.

## 10. Open questions
None.

## Change Log
- 2026-06-03 · PR test · created · fixture.
