#!/usr/bin/env bash
# Tests for spec-complete-check.sh and spec-links-check.sh against committed fixtures.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$HERE/.."
FX="$ROOT/__fixtures__/specs"
COMPLETE="$ROOT/spec-complete-check.sh"
LINKS="$ROOT/spec-links-check.sh"
pass=0; fail=0

assert_exit() { # <name> <expected> <actual>
  if [[ "$3" == "$2" ]]; then echo "ok   - $1"; pass=$((pass+1));
  else echo "FAIL - $1 (expected $2, got $3)"; fail=$((fail+1)); fi
}

# --- completeness ---
bash "$COMPLETE" "$FX/good.md" >/dev/null 2>&1;        assert_exit "good spec passes completeness" 0 $?
bash "$COMPLETE" "$FX/placeholder.md" >/dev/null 2>&1; assert_exit "placeholder spec fails completeness" 1 $?

# --- links ---
bash "$LINKS" "$FX/good.md" >/dev/null 2>&1;           assert_exit "good spec passes links" 0 $?
bash "$LINKS" "$FX/bad-link.md" >/dev/null 2>&1;       assert_exit "malformed counterpart fails links" 1 $?
SPECS_DIR="$FX" bash "$LINKS" "$FX/missing-related.md" >/dev/null 2>&1; assert_exit "unresolved related_spec fails links" 1 $?

echo "----"
echo "spec-lints tests: $pass passed, $fail failed"
[[ "$fail" == 0 ]]
