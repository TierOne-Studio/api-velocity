---
id: SPEC-907
title: "SPEC-907: Fixture missing required section"
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

# SPEC-907: Fixture missing required section

## 1. Summary
This fixture omits section "## 10." — completeness must FAIL on the missing required section.

## 2. Context & problem
Covers the missing-required-section failure branch.

## 3. Scope
In scope: nothing.

## 4. Assumptions
1. [Confirmed] none.

## 5. Affected areas
- src/features/Fixture

## 6. Acceptance criteria
| # | Criterion | Test |
|---|---|---|
| AC1 | missing section 10 fails completeness | this fixture (expect FAIL) |

## 7. Implementation plan
1. none.

## 8. Testing plan
Lints only.

## 9. Risks & failure modes
None.

## Change Log
- 2026-06-04 · PR test · created · fixture (intentionally no section 10).
