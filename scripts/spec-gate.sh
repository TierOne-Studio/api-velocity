#!/usr/bin/env bash
#
# spec-gate.sh — Specification-first hard gate (SPEC-000 / ADR-011).
#
# Fails when a behavioral source change ships WITHOUT a paired documentation update
# (a docs/specs/** SPEC or a docs/decisions/** ADR), unless a valid [skip-spec: ...]
# waiver token is present in the commit/PR body. A behavioral change documented via an
# ADR (decision/rationale) — common for bug fixes — counts as paired documentation.
#
# Behavioral source (NestJS) = src/**/*.ts, excluding *.spec.ts, *.e2e-spec.ts, *.d.ts.
# Paired documentation = a new OR modified docs/specs/**.md OR docs/decisions/**.md.
# Valid waivers (mirror tdd-workflow): type-only | config-no-behavior | non-code.
#
# Test seam (no git needed): set SPEC_GATE_FILES (newline-separated changed paths)
# and SPEC_GATE_MSG (commit/PR text). Otherwise computed from git vs SPEC_GATE_BASE.
set -euo pipefail

BASE_REF="${SPEC_GATE_BASE:-origin/master}"

if [[ -n "${SPEC_GATE_FILES+x}" ]]; then
  changed="$SPEC_GATE_FILES"
else
  changed="$(git diff --name-only "${BASE_REF}...HEAD")"
fi

if [[ -n "${SPEC_GATE_MSG+x}" ]]; then
  msg="$SPEC_GATE_MSG"
else
  msg="$(git log "${BASE_REF}...HEAD" --format=%B 2>/dev/null || true)"
fi

behavioral="$(printf '%s\n' "$changed" \
  | grep -E '^src/.*\.ts$' \
  | grep -Ev '\.(spec|e2e-spec)\.ts$|\.d\.ts$' || true)"

# Paired documentation: a SPEC (docs/specs/) or an ADR (docs/decisions/), new or modified.
doc_changed="$(printf '%s\n' "$changed" | grep -E '^docs/(specs|decisions)/.*\.md$' || true)"

waiver_re='\[skip-spec: (type-only|config-no-behavior|non-code)\]'

if [[ -n "$behavioral" && -z "$doc_changed" ]]; then
  if printf '%s' "$msg" | grep -Eq "$waiver_re"; then
    echo "spec-gate: behavioral change with a valid [skip-spec] waiver — PASS"
    exit 0
  fi
  {
    echo "::error::spec-gate: behavioral src/** changed without a docs/specs/** or docs/decisions/** update."
    echo "Changed behavioral files:"
    printf '  %s\n' $behavioral
    echo "Fix: create/update the governing SPEC under docs/specs/ OR an ADR under docs/decisions/,"
    echo "OR add a waiver token to the commit message / PR body if the change is genuinely non-behavioral:"
    echo "  [skip-spec: type-only] | [skip-spec: config-no-behavior] | [skip-spec: non-code]"
    echo '("small" / "obvious" / "trivial" are NEVER valid skips.)'
  } >&2
  exit 1
fi

echo "spec-gate: PASS"
exit 0
