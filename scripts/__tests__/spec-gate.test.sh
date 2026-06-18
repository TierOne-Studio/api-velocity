#!/usr/bin/env bash
# Tests for spec-gate.sh (NestJS/api) — exercises the gate via its env-var seam (no git needed).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/../spec-gate.sh"
pass=0; fail=0

# run_case <name> <expected_exit> ; reads SPEC_GATE_FILES/SPEC_GATE_MSG from env
run_case() {
  local name="$1" expected="$2"
  bash "$GATE" >/dev/null 2>&1
  local got=$?
  if [[ "$got" == "$expected" ]]; then
    echo "ok   - $name (exit $got)"; pass=$((pass+1))
  else
    echo "FAIL - $name (expected $expected, got $got)"; fail=$((fail+1))
  fi
}

# AC1: behavioral src change, no spec, no waiver -> FAIL (1)
SPEC_GATE_FILES=$'src/modules/users/users.service.ts' SPEC_GATE_MSG='fix users bug' \
  run_case "behavioral change without spec fails" 1

# AC2: behavioral src change + spec change -> PASS (0)
SPEC_GATE_FILES=$'src/modules/users/users.service.ts\ndocs/specs/SPEC-002-users-api.md' SPEC_GATE_MSG='fix users bug' \
  run_case "behavioral change with spec passes" 0

# AC2b: behavioral src change + ADR change -> PASS (0)
# Documentation pairing is satisfied by a docs/decisions/** (ADR) change, not only docs/specs/**.
SPEC_GATE_FILES=$'src/modules/users/users.service.ts\ndocs/decisions/ADR-099-users-fix.md' SPEC_GATE_MSG='fix users bug' \
  run_case "behavioral change with ADR passes" 0

# AC2c: behavioral src change + non-spec/non-ADR doc (e.g. README) -> still FAIL (1)
SPEC_GATE_FILES=$'src/modules/users/users.service.ts\ndocs/README.md' SPEC_GATE_MSG='fix users bug' \
  run_case "behavioral change with unrelated doc still fails" 1

# AC3: behavioral src change, no spec, valid waiver -> PASS (0)
SPEC_GATE_FILES=$'src/shared/types/index.ts' SPEC_GATE_MSG=$'chore: retype\n\n[skip-spec: type-only]' \
  run_case "valid waiver passes" 0

# invalid waiver reason -> still FAIL
SPEC_GATE_FILES=$'src/modules/users/users.service.ts' SPEC_GATE_MSG=$'wip\n\n[skip-spec: trivial]' \
  run_case "invalid waiver reason fails" 1

# unit-spec-only change (no behavioral src) -> PASS
SPEC_GATE_FILES=$'src/modules/users/users.service.spec.ts' SPEC_GATE_MSG='add tests' \
  run_case "spec-only change passes" 0

# d.ts-only change -> PASS
SPEC_GATE_FILES=$'src/shared/api/types.d.ts' SPEC_GATE_MSG='types' \
  run_case "d.ts-only change passes" 0

# docs-only change (no src) -> PASS
SPEC_GATE_FILES=$'docs/specs/SPEC-002-users-api.md' SPEC_GATE_MSG='update spec' \
  run_case "docs-only change passes" 0

# e2e change under test/ (not src) -> PASS
SPEC_GATE_FILES=$'test/admin.e2e-spec.ts' SPEC_GATE_MSG='e2e' \
  run_case "e2e change passes" 0

echo "----"
echo "spec-gate tests: $pass passed, $fail failed"
[[ "$fail" == 0 ]]
