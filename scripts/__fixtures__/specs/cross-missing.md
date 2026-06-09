---
id: SPEC-909
title: "SPEC-909: Fixture cross-repo counterpart missing"
status: Implemented
layer: ui
owner: Test
created: 2026-06-04
updated: 2026-06-04
feature_paths:
  - src/features/Fixture
related_adrs: []
related_specs: []
counterpart_spec: "otherrepo#SPEC-906"
coordination_doc: ""
---

# SPEC-909: Fixture cross-repo counterpart missing

Used by the links test with COUNTERPART_REPO_ROOT pointing at the `_counterpart` tree
(which has only SPEC-905, not SPEC-906) — counterpart_spec MUST fail to resolve (exit 1).
