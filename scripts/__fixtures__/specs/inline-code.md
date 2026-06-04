---
id: SPEC-904
title: "SPEC-904: Fixture inline-code placeholder"
status: Implemented
layer: ui
owner: Test
created: 2026-06-04
updated: 2026-06-04
feature_paths:
  - src/features/Fixture
related_adrs: []
related_specs: []
counterpart_spec: "standalone"
coordination_doc: ""
---

# SPEC-904: Fixture inline-code placeholder

## 1. Summary
This spec mentions the token `TBD` and `<Feature>` ONLY inside inline code spans, as documentation
about placeholders — the completeness lint must NOT flag these. A bare placeholder still fails.

## 2. Context & problem
Protects the inline-code false-positive guard in spec-complete-check.sh.

## 3. Scope
In scope: the `TBD` token detection. Out of scope: everything else.

## 4. Assumptions
1. [Confirmed] none.

## 5. Affected areas
- src/features/Fixture

## 6. Acceptance criteria
| # | Criterion | Test |
|---|---|---|
| AC1 | backticked `TBD` does not fail completeness | this fixture (expect PASS) |

## 7. Implementation plan
1. none. slice: 0.

## 8. Testing plan
Lints only.

## 9. Risks & failure modes
None.

## 10. Open questions
None.

## Change Log
- 2026-06-04 · PR test · created · fixture.
