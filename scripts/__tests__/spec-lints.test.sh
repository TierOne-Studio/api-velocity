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

# completeness — additional failure/guard branches
bash "$COMPLETE" "$FX/inline-code.md" >/dev/null 2>&1;     assert_exit "backticked placeholder passes completeness (inline-code guard)" 0 $?
bash "$COMPLETE" "$FX/empty-key.md" >/dev/null 2>&1;       assert_exit "empty frontmatter key fails completeness" 1 $?
bash "$COMPLETE" "$FX/missing-section.md" >/dev/null 2>&1; assert_exit "missing required section fails completeness" 1 $?

# links — cross-repo COUNTERPART_REPO_ROOT resolution (both arms)
COUNTERPART_REPO_ROOT="$FX/../_counterpart" bash "$LINKS" "$FX/cross-ok.md" >/dev/null 2>&1;      assert_exit "cross-repo counterpart resolves with root set" 0 $?
COUNTERPART_REPO_ROOT="$FX/../_counterpart" bash "$LINKS" "$FX/cross-missing.md" >/dev/null 2>&1; assert_exit "cross-repo counterpart missing fails with root set" 1 $?

echo "----"
echo "spec-lints tests: $pass passed, $fail failed"
[[ "$fail" == 0 ]]
