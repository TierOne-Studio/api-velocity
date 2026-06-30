#!/usr/bin/env bash
# Tests for verify-build.mjs — exercises the guard via its VERIFY_BUILD_DIST seam
# against throwaway fixture dirs (no real build needed). Mirrors the no-fallback
# artifact contract: dist/main.js + dist/public-widget/widget.js must both exist.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$HERE/../verify-build.mjs"
pass=0; fail=0

# run_case <name> <fixture_dir> <expected_exit>
run_case() {
  local name="$1" dist="$2" expected="$3"
  VERIFY_BUILD_DIST="$dist" node "$GUARD" >/dev/null 2>&1
  local got=$?
  if [[ "$got" == "$expected" ]]; then
    echo "ok   - $name (exit $got)"; pass=$((pass+1))
  else
    echo "FAIL - $name (expected $expected, got $got)"; fail=$((fail+1))
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# complete dist -> PASS (0)
complete="$TMP/complete/dist"
mkdir -p "$complete/public-widget"
: > "$complete/main.js"
: > "$complete/public-widget/widget.js"
run_case "complete dist passes" "$complete" 0

# entrypoint nested under dist/src (the exact prod incident) -> FAIL (1)
nested="$TMP/nested/dist"
mkdir -p "$nested/src" "$nested/public-widget"
: > "$nested/src/main.js"
: > "$nested/public-widget/widget.js"
run_case "entrypoint nested under dist/src fails" "$nested" 1

# widget bundle missing (no-fallback request-time artifact) -> FAIL (1)
nowidget="$TMP/nowidget/dist"
mkdir -p "$nowidget"
: > "$nowidget/main.js"
run_case "missing widget bundle fails" "$nowidget" 1

# empty dist -> FAIL (1)
run_case "empty dist fails" "$TMP/empty/dist" 1

echo "----"
echo "passed: $pass, failed: $fail"
[[ "$fail" == "0" ]] || exit 1
