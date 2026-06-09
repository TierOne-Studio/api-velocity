---
id: SPEC-908
title: "SPEC-908: Fixture cross-repo counterpart resolves"
status: Implemented
layer: ui
owner: Test
created: 2026-06-04
updated: 2026-06-04
feature_paths:
  - src/features/Fixture
related_adrs: []
related_specs: []
counterpart_spec: "otherrepo#SPEC-905"
coordination_doc: ""
---

# SPEC-908: Fixture cross-repo counterpart resolves

Used by the links test with COUNTERPART_REPO_ROOT pointing at the `_counterpart` tree
(which contains SPEC-905) — counterpart_spec MUST resolve (exit 0).
