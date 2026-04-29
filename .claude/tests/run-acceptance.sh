#!/usr/bin/env bash
# run-acceptance.sh — acceptance tests for the no-hooks agent profile.
# Architecture: skills + subagents + CLAUDE.md only. Permissions.deny replaces guard hooks.
# Usage: bash .claude/tests/run-acceptance.sh

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

# Preflight: required CLI tools. The script uses bash, grep, awk, sed, find, wc — all POSIX-standard.
# jq is needed for JSON-parsing assertions (Python sometimes used as fallback elsewhere; not here).
for tool in bash grep awk sed find wc; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "PRE-FAIL: required tool '$tool' not found on PATH" >&2
    echo "  install via your package manager (e.g., 'brew install coreutils' on macOS, or your distro's gnu-coreutils)" >&2
    exit 2
  fi
done

PASS=0
FAIL=0
FAILED_TESTS=""

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected=$expected, actual=$actual)"
    FAIL=$((FAIL+1)); FAILED_TESTS="$FAILED_TESTS $name"
  fi
}
assert_true() {
  local name="$1" cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (command failed: $cmd)"
    FAIL=$((FAIL+1)); FAILED_TESTS="$FAILED_TESTS $name"
  fi
}

echo "=== T1: File structure ==="
for f in CLAUDE.md \
         .claude/settings.json \
         .claude/skills/tdd-workflow/SKILL.md \
         .claude/skills/design-review/SKILL.md \
         .claude/skills/plan-mode/SKILL.md \
         .claude/skills/rlm-explore/SKILL.md \
         .claude/skills/bug-investigation/SKILL.md \
         .claude/skills/db-write-protocol/SKILL.md \
         .claude/skills/git-workflow/SKILL.md \
         .claude/skills/meta-skill-hygiene/SKILL.md \
         .claude/skills/failure-mode-analysis/SKILL.md \
         .claude/skills/repo-conventions/SKILL.md \
         .claude/skills/decision-rules/SKILL.md \
         .claude/skills/pushback-templates/SKILL.md \
         .claude/agents/lessons-curator.md \
         .claude/agents/code-reviewer.md \
         .claude/agents/architect-reviewer.md \
         .claude/agents/qa-validator.md \
         .claude/agents/security-reviewer.md; do
  assert_true "T1: file $f exists" "test -f '$f'"
done
assert_true "T1: .claude/hooks/ is removed" "! test -d .claude/hooks"
assert_true "T1: .claude/.state/ is removed" "! test -d .claude/.state"

echo
echo "=== T13: CLAUDE.md size <= 3500 words (priority-structured mode — index + P0..P9 + MUST/SHOULD/MAY + inline rubric for parity) ==="
WORDS=$(wc -w < CLAUDE.md | tr -d '[:space:]')
if [ "$WORDS" -le 3500 ]; then
  echo "PASS: T13 (CLAUDE.md is $WORDS words; gate is 3500 to accommodate the inline confidence rubric and high-risk restate rule)"; PASS=$((PASS+1))
else
  echo "FAIL: T13 (CLAUDE.md is $WORDS words, expected <= 3500)"
  FAIL=$((FAIL+1)); FAILED_TESTS="$FAILED_TESTS T13"
fi

echo
echo "=== T14: Skill descriptions well-formed (12 owned skills) ==="
OWNED_SKILLS="tdd-workflow design-review plan-mode rlm-explore bug-investigation db-write-protocol git-workflow meta-skill-hygiene failure-mode-analysis repo-conventions decision-rules pushback-templates"
for s in $OWNED_SKILLS; do
  sk=".claude/skills/$s/SKILL.md"
  has_yaml=$(head -1 "$sk")
  if [ "$has_yaml" != "---" ]; then
    echo "FAIL: T14 $sk missing YAML frontmatter"
    FAIL=$((FAIL+1)); FAILED_TESTS="$FAILED_TESTS T14:$sk"; continue
  fi
  desc=$(awk '/^description:/{sub(/^description:[[:space:]]*/,""); print; exit}' "$sk")
  if ! printf '%s' "$desc" | grep -Eq '^Use (when|ALWAYS when|BEFORE|PROACTIVELY|TWICE)'; then
    echo "FAIL: T14 $sk description does not start with 'Use when/ALWAYS when/BEFORE/PROACTIVELY/TWICE' (got: ${desc:0:60})"
    FAIL=$((FAIL+1)); FAILED_TESTS="$FAILED_TESTS T14:$sk"; continue
  fi
  if ! printf '%s' "$desc" | grep -q 'NOT for'; then
    echo "FAIL: T14 $sk description missing 'NOT for' clause"
    FAIL=$((FAIL+1)); FAILED_TESTS="$FAILED_TESTS T14:$sk"; continue
  fi
  echo "PASS: T14 $sk"; PASS=$((PASS+1))
done

echo
echo "=== T15: Subagent tool allowlists ==="
LC_TOOLS=$(awk '/^tools:/{sub(/^tools:[[:space:]]*/,""); print; exit}' .claude/agents/lessons-curator.md)
CR_TOOLS=$(awk '/^tools:/{sub(/^tools:[[:space:]]*/,""); print; exit}' .claude/agents/code-reviewer.md)
assert_true "T15: lessons-curator has 'Read'"  "echo '$LC_TOOLS' | grep -q Read"
assert_true "T15: lessons-curator has 'Grep'"  "echo '$LC_TOOLS' | grep -q Grep"
assert_true "T15: lessons-curator has 'Glob'"  "echo '$LC_TOOLS' | grep -q Glob"
assert_true "T15: lessons-curator NO 'Edit'"   "! echo '$LC_TOOLS' | grep -wq Edit"
assert_true "T15: lessons-curator NO 'Write'"  "! echo '$LC_TOOLS' | grep -wq Write"
assert_true "T15: lessons-curator NO 'Bash'"   "! echo '$LC_TOOLS' | grep -wq Bash"
assert_true "T15: code-reviewer has 'Bash'"    "echo '$CR_TOOLS' | grep -q Bash"
assert_true "T15: code-reviewer NO 'Edit'"     "! echo '$CR_TOOLS' | grep -wq Edit"
assert_true "T15: code-reviewer NO 'Write'"    "! echo '$CR_TOOLS' | grep -wq Write"

echo
echo "=== T16: settings.json validity ==="
assert_true "T16: jq parses .claude/settings.json" "jq . .claude/settings.json"

echo
echo "=== T19: CLAUDE.md operating-mindset has always-on bullets ==="
assert_true "T19: 'No retries'"        "grep -qi 'no retries' CLAUDE.md"
assert_true "T19: 'Full test suite'"   "grep -qi 'full test suite' CLAUDE.md"
assert_true "T19: 'Stop on confusion'" "grep -qi 'stop on confusion' CLAUDE.md"
assert_true "T19: 'Pushback'"          "grep -qi 'pushback' CLAUDE.md"
assert_true "T19: 'Surgical'"          "grep -qi 'surgical' CLAUDE.md"

echo
echo "=== T22: code-reviewer description uses 'Use ALWAYS' not 'Use PROACTIVELY' ==="
CR_DESC=$(awk '/^description:/{sub(/^description:[[:space:]]*/,""); print; exit}' .claude/agents/code-reviewer.md)
assert_true "T22: starts with 'Use ALWAYS'" "echo '$CR_DESC' | grep -q '^Use ALWAYS'"
assert_true "T22: no 'Use PROACTIVELY'"     "! echo '$CR_DESC' | grep -q 'Use PROACTIVELY'"

echo
echo "=== T23: settings.json has NO hooks block ==="
HAS_HOOKS=$(jq 'has("hooks")' .claude/settings.json)
assert_eq "T23: settings.json.hooks absent" "false" "$HAS_HOOKS"

echo
echo "=== T24: settings.json has permissions.deny with main + SQL patterns ==="
HAS_PERMS=$(jq 'has("permissions") and .permissions.deny != null and (.permissions.deny | length) > 0' .claude/settings.json)
assert_eq "T24: permissions.deny populated" "true" "$HAS_PERMS"
assert_true "T24: deny contains git main"    "jq -e '.permissions.deny | any(test(\"git push.*main\"))' .claude/settings.json"
assert_true "T24: deny contains git master"  "jq -e '.permissions.deny | any(test(\"git push.*master\"))' .claude/settings.json"
assert_true "T24: deny contains git --force" "jq -e '.permissions.deny | any(test(\"git push --force\"))' .claude/settings.json"
assert_true "T24: deny contains mysql DELETE" "jq -e '.permissions.deny | any(test(\"mysql.*DELETE\"))' .claude/settings.json"
assert_true "T24: deny contains psql DELETE"  "jq -e '.permissions.deny | any(test(\"psql.*DELETE\"))' .claude/settings.json"
assert_true "T24: deny contains DROP"         "jq -e '.permissions.deny | any(test(\"DROP\"))' .claude/settings.json"

echo
echo "=== T25: CLAUDE.md has approval-required protocol ==="
assert_true "T25: 'Approval-required operations' section" "grep -qi 'Approval-required operations' CLAUDE.md"
assert_true "T25: 'Pre-action protocol' subsection"       "grep -qi 'Pre-action protocol' CLAUDE.md"
assert_true "T25: literal 'Awaiting approval' line"       "grep -q 'Awaiting approval' CLAUDE.md"
assert_true "T25: explicit 'approve' keyword"             "grep -q \"'approve'\" CLAUDE.md"
assert_true "T25: forbidden bypass phrases listed"        "grep -qi 'Forbidden bypass phrases' CLAUDE.md"

echo
echo "=== T26: CLAUDE.md mandates code-reviewer verification ==="
assert_true "T26: 'Mandatory verification' section"     "grep -qi 'Mandatory verification' CLAUDE.md"
assert_true "T26: code-reviewer named"                  "grep -q 'code-reviewer' CLAUDE.md"
assert_true "T26: 3+ files threshold mentioned"         "grep -Eq '3\\+ files|3 \\+ files' CLAUDE.md"
assert_true "T26: auth/payments/sessions etc. mentioned" "grep -Eqi 'auth.*payments.*sessions|auth / payments / sessions' CLAUDE.md"

echo
echo "=== T27: architect-reviewer subagent well-formed ==="
AR_DESC=$(awk '/^description:/{sub(/^description:[[:space:]]*/,""); print; exit}' .claude/agents/architect-reviewer.md)
AR_TOOLS=$(awk '/^tools:/{sub(/^tools:[[:space:]]*/,""); print; exit}' .claude/agents/architect-reviewer.md)
assert_true "T27: description starts 'Use BEFORE'"  "echo '$AR_DESC' | grep -q '^Use BEFORE'"
assert_true "T27: description has 'NOT for'"        "echo '$AR_DESC' | grep -q 'NOT for'"
assert_true "T27: tools has Read"                   "echo '$AR_TOOLS' | grep -q Read"
assert_true "T27: tools NO Edit"                    "! echo '$AR_TOOLS' | grep -wq Edit"
assert_true "T27: tools NO Write"                   "! echo '$AR_TOOLS' | grep -wq Write"
assert_true "T27: tools NO Bash"                    "! echo '$AR_TOOLS' | grep -wq Bash"
assert_true "T27: emits APPROVE_PLAN verdict"       "grep -q APPROVE_PLAN .claude/agents/architect-reviewer.md"

echo
echo "=== T28: qa-validator subagent well-formed ==="
QA_DESC=$(awk '/^description:/{sub(/^description:[[:space:]]*/,""); print; exit}' .claude/agents/qa-validator.md)
QA_TOOLS=$(awk '/^tools:/{sub(/^tools:[[:space:]]*/,""); print; exit}' .claude/agents/qa-validator.md)
assert_true "T28: description starts 'Use ALWAYS'" "echo '$QA_DESC' | grep -q '^Use ALWAYS'"
assert_true "T28: description has 'NOT for'"       "echo '$QA_DESC' | grep -q 'NOT for'"
assert_true "T28: tools has Bash"                  "echo '$QA_TOOLS' | grep -q Bash"
assert_true "T28: tools NO Edit"                   "! echo '$QA_TOOLS' | grep -wq Edit"
assert_true "T28: tools NO Write"                  "! echo '$QA_TOOLS' | grep -wq Write"
assert_true "T28: emits PASS verdict"              "grep -q '^.*PASS.*GAPS.*BLOCK' .claude/agents/qa-validator.md"

echo
echo "=== T29: security-reviewer subagent well-formed ==="
SR_DESC=$(awk '/^description:/{sub(/^description:[[:space:]]*/,""); print; exit}' .claude/agents/security-reviewer.md)
SR_TOOLS=$(awk '/^tools:/{sub(/^tools:[[:space:]]*/,""); print; exit}' .claude/agents/security-reviewer.md)
assert_true "T29: description starts 'Use ALWAYS'" "echo '$SR_DESC' | grep -q '^Use ALWAYS'"
assert_true "T29: description has 'NOT for'"       "echo '$SR_DESC' | grep -q 'NOT for'"
assert_true "T29: tools has Bash"                  "echo '$SR_TOOLS' | grep -q Bash"
assert_true "T29: tools NO Edit"                   "! echo '$SR_TOOLS' | grep -wq Edit"
assert_true "T29: tools NO Write"                  "! echo '$SR_TOOLS' | grep -wq Write"
assert_true "T29: covers OWASP top-10"             "grep -qi 'OWASP' .claude/agents/security-reviewer.md"
assert_true "T29: covers RBAC scope contract"      "grep -qi 'RBAC\\|scope=' .claude/agents/security-reviewer.md"

echo
echo "=== T30: failure-mode-analysis skill well-formed ==="
FMA_DESC=$(awk '/^description:/{sub(/^description:[[:space:]]*/,""); print; exit}' .claude/skills/failure-mode-analysis/SKILL.md)
assert_true "T30: description starts 'Use TWICE' (plan-mode + tdd-workflow)" "echo '$FMA_DESC' | grep -qE '^Use (BEFORE|TWICE)'"
assert_true "T30: description has 'NOT for'"       "echo '$FMA_DESC' | grep -q 'NOT for'"
assert_true "T30: lists 8 categories"              "grep -Ec '^### [0-9]\\.' .claude/skills/failure-mode-analysis/SKILL.md | grep -q '^8$'"

echo
echo "=== T31: code-reviewer narrowed (design-only, delegates) ==="
assert_true "T31: description names DESIGN principles only" "grep -q 'DESIGN' .claude/agents/code-reviewer.md"
assert_true "T31: delegates to qa-validator"                "grep -q 'qa-validator' .claude/agents/code-reviewer.md"
assert_true "T31: delegates to security-reviewer"           "grep -q 'security-reviewer' .claude/agents/code-reviewer.md"
assert_true "T31: NO 'what TDD missed' section in body"    "! grep -q 'what TDD missed' .claude/agents/code-reviewer.md"

echo
echo "=== T32: confidence rubric present (CLAUDE.md canonical, design-review carries calibration depth) ==="
assert_true "T32: 'Confidence rubric' canonical in CLAUDE.md P8.1"  "grep -q 'P8.1 Confidence rubric' CLAUDE.md"
assert_true "T32: 5 rubric items (each worth 0.20) in CLAUDE.md"    "[ \$(grep -c '| 0.20 |' CLAUDE.md) -ge 5 ]"
assert_true "T32: 0.9 gate enforced in CLAUDE.md"                   "grep -q 'sum < 0.90, MUST revise' CLAUDE.md"
assert_true "T32: design-review keeps calibration anchors"           "grep -q 'Calibration anchors' .claude/skills/design-review/SKILL.md"
assert_true "T32: design-review references CLAUDE.md as canonical"   "grep -q 'CLAUDE.md.*P8.1' .claude/skills/design-review/SKILL.md"

echo
echo "=== T33: CLAUDE.md mandates all 4 review subagents ==="
assert_true "T33: architect-reviewer named"  "grep -q 'architect-reviewer' CLAUDE.md"
assert_true "T33: code-reviewer named"       "grep -q 'code-reviewer' CLAUDE.md"
assert_true "T33: qa-validator named"        "grep -q 'qa-validator' CLAUDE.md"
assert_true "T33: security-reviewer named"   "grep -q 'security-reviewer' CLAUDE.md"
assert_true "T33: pre-impl architect timing" "grep -Eqi 'BEFORE|PRE-implementation' CLAUDE.md"
assert_true "T33: failure-mode-analysis named OR mandated via tdd-workflow" "grep -q 'tdd-workflow\\|failure-mode-analysis' CLAUDE.md"

echo
echo "=== T34: design-review has calibration anchors + concrete anti-pattern examples + output criteria ==="
assert_true "T34: 'Calibration anchors' band 0.95"   "grep -q '0.95' .claude/skills/design-review/SKILL.md"
assert_true "T34: anti-pattern examples (code block)" "grep -q '^// Bad' .claude/skills/design-review/SKILL.md"
assert_true "T34: 'Output contract — quality criteria'" "grep -q 'quality criteria' .claude/skills/design-review/SKILL.md"

echo
echo "=== T35: tdd-workflow has test quality rubric (10 items) ==="
assert_true "T35: 'Test quality rubric' present" "grep -q 'Test quality rubric' .claude/skills/tdd-workflow/SKILL.md"
RUBRIC_ITEMS=$(grep -cE '^[0-9]+\. \*\*' .claude/skills/tdd-workflow/SKILL.md)
if [ "$RUBRIC_ITEMS" -ge 10 ]; then
  echo "PASS: T35 (rubric has $RUBRIC_ITEMS numbered items)"; PASS=$((PASS+1))
else
  echo "FAIL: T35 (rubric has $RUBRIC_ITEMS numbered items, expected >= 10)"
  FAIL=$((FAIL+1)); FAILED_TESTS="$FAILED_TESTS T35"
fi

echo
echo "=== T36: qa-validator mirrors test quality rubric ==="
assert_true "T36: 'Test quality rubric' in qa-validator" "grep -q 'Test quality rubric' .claude/agents/qa-validator.md"

echo
echo "=== T37: CLAUDE.md has repo-core conventions + decision rules + pushback templates ==="
assert_true "T37: repo-core conventions section"    "grep -qi 'repo-core conventions' CLAUDE.md"
assert_true "T37: '@RequirePermissions' named"       "grep -q '@RequirePermissions' CLAUDE.md"
assert_true "T37: 'organization_id' query rule"     "grep -q 'organization_id' CLAUDE.md"
assert_true "T37: decision rules section"            "grep -qi 'decision rules' CLAUDE.md"
assert_true "T37: pushback templates section"        "grep -qi 'pushback' CLAUDE.md"
assert_true "T37: priority order index"              "grep -qi 'priority order' CLAUDE.md"
assert_true "T37: MUST/SHOULD usage (priority structure)" "grep -q 'MUST' CLAUDE.md && grep -q 'SHOULD' CLAUDE.md"

echo
echo "=== T38: repo-conventions skill has key sections ==="
assert_true "T38: 'Module layout' section"            "grep -qi 'Module layout' .claude/skills/repo-conventions/SKILL.md"
assert_true "T38: 'RBAC scope contract'"              "grep -qi 'RBAC scope contract' .claude/skills/repo-conventions/SKILL.md"
assert_true "T38: 'Repository pattern' section"       "grep -qi 'Repository pattern' .claude/skills/repo-conventions/SKILL.md"
assert_true "T38: 'Projects + multi-source chat'"     "grep -qi 'multi-source chat' .claude/skills/repo-conventions/SKILL.md"
assert_true "T38: 'Repo-specific anti-patterns'"      "grep -qi 'Repo-specific anti-patterns' .claude/skills/repo-conventions/SKILL.md"
assert_true "T38: NestJS Logger (not pino) noted"    "grep -qi 'NestJS.*Logger' .claude/skills/repo-conventions/SKILL.md"
assert_true "T38: hybrid persistence noted (raw SQL + TypeORM in RBAC)" "grep -qiE 'TypeORM in RBAC|TypeORM.*RBAC|RBAC.*TypeORM|Hybrid persistence' .claude/skills/repo-conventions/SKILL.md"

echo
echo "=== T39: decision-rules skill has full table content ==="
assert_true "T39: 'Full decision table' present"     "grep -q 'Full decision table' .claude/skills/decision-rules/SKILL.md"
assert_true "T39: covers Bug fix scope rule"         "grep -qi 'Bug fix scope' .claude/skills/decision-rules/SKILL.md"
assert_true "T39: covers Failing test that looks wrong" "grep -qi 'Failing test that looks wrong' .claude/skills/decision-rules/SKILL.md"
assert_true "T39: covers CLAUDE.md vs skill conflict"  "grep -qi 'CLAUDE.md vs skill' .claude/skills/decision-rules/SKILL.md"
assert_true "T39: covers Confidence rubric below 0.90" "grep -qi 'Confidence rubric scores below 0.90' .claude/skills/decision-rules/SKILL.md"

echo
echo "=== T40: pushback-templates skill has all 4 templates ==="
assert_true "T40: 'Simpler alternative' template"   "grep -qi 'Simpler alternative spotted' .claude/skills/pushback-templates/SKILL.md"
assert_true "T40: 'Scope creep' template"           "grep -qi 'Scope creep risk' .claude/skills/pushback-templates/SKILL.md"
assert_true "T40: 'Hidden risk' template"           "grep -qi 'Hidden risk' .claude/skills/pushback-templates/SKILL.md"
assert_true "T40: 'Genuine disagreement' template"  "grep -qi 'Genuine disagreement with framing' .claude/skills/pushback-templates/SKILL.md"
assert_true "T40: example dialogues present"        "grep -qi 'Example dialogue' .claude/skills/pushback-templates/SKILL.md"

echo
echo "=== T41: CLAUDE.md has priority index + P0..P9 sections + condensed P6 + skill pointers ==="
assert_true "T41: 'PRIORITY ORDER' index"           "grep -q 'PRIORITY ORDER' CLAUDE.md"
assert_true "T41: 'MUST / SHOULD / MAY' guidance"  "grep -q 'MUST / SHOULD / MAY' CLAUDE.md"
assert_true "T41: P0 section present"               "grep -q '^## P0' CLAUDE.md"
assert_true "T41: P9 section present"               "grep -q '^## P9' CLAUDE.md"
assert_true "T41: P6.1 condensed (refs decision-rules skill)" "grep -q 'in \`decision-rules\` skill' CLAUDE.md"
assert_true "T41: P6.2 condensed (refs pushback-templates skill)" "grep -q 'in \`pushback-templates\` skill' CLAUDE.md"
assert_true "T41: skill pointers row for decision-rules"     "grep -q '\`decision-rules\`' CLAUDE.md"
assert_true "T41: skill pointers row for pushback-templates" "grep -q '\`pushback-templates\`' CLAUDE.md"
assert_true "T41: P9 'no retries' duplicate removed (only in P5)" "[ \$(grep -c 'No retries\\|MUST NOT implement retries' CLAUDE.md) -le 1 ]"

echo
echo "=== T42: parity-with-monolith rules inlined into CLAUDE.md ==="
assert_true "T42: P3.3 high-risk restate rule present"            "grep -q 'P3.3 High-risk restate' CLAUDE.md"
assert_true "T42: high-risk surface list explicit"                "grep -q 'auth, sessions, RBAC, payments' CLAUDE.md"
assert_true "T42: restate happens regardless of plan-mode firing" "grep -q 'plan-mode.*does.*not fire\\|even if .plan-mode. doesn.t fire' CLAUDE.md"
assert_true "T42: P5 memory-consultation bullet"                  "grep -q 'Consult feedback memories' CLAUDE.md"
assert_true "T42: P5 names MEMORY.md as the index"                "grep -q 'MEMORY.md' CLAUDE.md"
assert_true "T42: tdd-workflow Step 5 — requirement coverage"     "grep -qi 'requirement coverage' .claude/skills/tdd-workflow/SKILL.md"
assert_true "T42: tdd-workflow Step 5 — assumptions validated"    "grep -qi 'assumptions validated' .claude/skills/tdd-workflow/SKILL.md"
assert_true "T42: tdd-workflow Step 5 — security/perf flags"      "grep -qi 'security.*perf' .claude/skills/tdd-workflow/SKILL.md"
assert_true "T42: tdd-workflow refs CLAUDE.md P8.1 for confidence" "grep -q 'CLAUDE.md.*P8.1' .claude/skills/tdd-workflow/SKILL.md"

echo
echo "=== T43: P3.4 mandatory-skill-invocation matrix forces fire-even-if-not-triggered ==="
assert_true "T43: P3.4 section header present"                "grep -q 'P3.4 Mandatory skill invocation' CLAUDE.md"
assert_true "T43: tdd-workflow named MUST-fire"               "grep -q '| \`tdd-workflow\` |' CLAUDE.md"
assert_true "T43: failure-mode-analysis named MUST-fire"      "grep -q '| \`failure-mode-analysis\` |' CLAUDE.md"
assert_true "T43: repo-conventions named MUST-fire"           "grep -q '| \`repo-conventions\` |' CLAUDE.md"
assert_true "T43: design-review named MUST-fire"              "grep -q '| \`design-review\` |' CLAUDE.md"
assert_true "T43: plan-mode named MUST-fire"                  "grep -q '| \`plan-mode\` |' CLAUDE.md"
assert_true "T43: 'override description-trigger' framing"     "grep -qi 'override description-trigger\\|even if their description' CLAUDE.md"
assert_true "T43: silent-skip explicitly forbidden"           "grep -q 'Do NOT silently skip' CLAUDE.md"

echo
echo "=== T44: cross-validation — load-bearing rules don't drift between CLAUDE.md and skills ==="
# Each rule in CLAUDE.md must also appear in its canonical skill so the deeper content stays consistent.
assert_true "T44: P3.3 high-risk surfaces also listed in security-reviewer mandate" \
  "grep -qi 'auth.*RBAC\\|RBAC.*auth\\|auth.*payments\\|payments.*auth' .claude/agents/security-reviewer.md"
assert_true "T44: P5 'Consult feedback memories' mirrored — lessons-curator names feedback memory" \
  "grep -qi 'feedback' .claude/agents/lessons-curator.md"
assert_true "T44: tdd-workflow Step 5 confidence cross-link to CLAUDE.md P8.1" \
  "grep -q 'CLAUDE.md.*P8.1' .claude/skills/tdd-workflow/SKILL.md"
assert_true "T44: design-review confidence cross-link to CLAUDE.md P8.1" \
  "grep -q 'CLAUDE.md.*P8.1' .claude/skills/design-review/SKILL.md"
assert_true "T44: P0 deny-list patterns are real git syntax (no fake 'merge --into')" \
  "! grep -q 'merge --into' .claude/settings.json"
assert_true "T44: P0 deny-list patterns are real git syntax (no fake 'rebase --root <branch>')" \
  "! grep -qE 'rebase --root (main|master)' .claude/settings.json"
assert_true "T44: no orphan hook-enforcement claims in skills" \
  "! grep -rE 'enforce-tdd|enforce-design|guard-main|guard-sql|CLAUDE_DB_WRITE_APPROVED' .claude/skills/ .claude/agents/ CLAUDE.md"
assert_true "T44: NestJS version in repo-conventions matches package.json (no 'NestJS 10')" \
  "! grep -q 'NestJS 10$\\|NestJS 10 ' .claude/skills/repo-conventions/SKILL.md"

echo
echo "=== T45: subagents have Required Reading preamble (canonical-source loading) ==="
assert_true "T45: architect-reviewer Required reading"   "grep -q 'Required reading' .claude/agents/architect-reviewer.md"
assert_true "T45: code-reviewer Required reading"        "grep -q 'Required reading' .claude/agents/code-reviewer.md"
assert_true "T45: qa-validator Required reading"         "grep -q 'Required reading' .claude/agents/qa-validator.md"
assert_true "T45: security-reviewer Required reading"    "grep -q 'Required reading' .claude/agents/security-reviewer.md"
assert_true "T45: architect-reviewer reads CLAUDE.md"    "grep -q 'Read.*CLAUDE.md\\|CLAUDE.md.*Read\\|MUST Read' .claude/agents/architect-reviewer.md"
assert_true "T45: code-reviewer reads repo-conventions"  "grep -q 'repo-conventions' .claude/agents/code-reviewer.md"
assert_true "T45: security-reviewer reads repo-conventions" "grep -q 'repo-conventions' .claude/agents/security-reviewer.md"
assert_true "T45: qa-validator reads failure-mode-analysis" "grep -q 'failure-mode-analysis' .claude/agents/qa-validator.md"

echo
echo "=== T46: subagents perform CLAUDE.md compliance audits ==="
assert_true "T46: architect-reviewer audits plan format"        "grep -q 'CLAUDE.md compliance' .claude/agents/architect-reviewer.md"
assert_true "T46: architect-reviewer checks high-risk restate"  "grep -qi 'high-risk restate.*P3.3\\|P3.3.*high-risk' .claude/agents/architect-reviewer.md"
assert_true "T46: code-reviewer checks Design review block"     "grep -q 'Design review.*block\\|Design review:.*block' .claude/agents/code-reviewer.md"
assert_true "T46: code-reviewer checks Confidence line"         "grep -qE '\\\`Confidence:\\\`' .claude/agents/code-reviewer.md"
assert_true "T46: code-reviewer checks repo-conventions"        "grep -q 'NestJS exceptions' .claude/agents/code-reviewer.md"
assert_true "T46: code-reviewer flags forbidden waiver phrases" "grep -q 'forbidden waiver phrases\\|Forbidden waiver phrases\\|forbidden non-waiver\\|small change.*obvious fix' .claude/agents/code-reviewer.md"
assert_true "T46: qa-validator failure-mode bridge (8 categories)" "[ \$(grep -cE '^\\| \\*\\*(null|empty|large|race|partial|network|malformed|boundary)\\*\\*' .claude/agents/qa-validator.md) -ge 8 ]"
assert_true "T46: qa-validator checks tests-before-impl ordering"  "grep -qi 'tests.*before.*implementation\\|Tests-before-implementation\\|tests-before-impl' .claude/agents/qa-validator.md"

echo
echo "=== T47: subagent confidence aligned with CLAUDE.md P8.1 rubric ==="
assert_true "T47: architect-reviewer cites P8.1 for confidence"  "grep -q 'P8.1' .claude/agents/architect-reviewer.md"
assert_true "T47: code-reviewer cites P8.1 for confidence"       "grep -q 'P8.1' .claude/agents/code-reviewer.md"
assert_true "T47: qa-validator cites P8.1 for confidence"        "grep -q 'P8.1' .claude/agents/qa-validator.md"
assert_true "T47: security-reviewer cites P8.1 for confidence"   "grep -q 'P8.1' .claude/agents/security-reviewer.md"

echo
echo "=== T48: lessons-curator consults auto-memory before proposing ==="
assert_true "T48: lessons-curator references MEMORY.md"           "grep -q 'MEMORY.md' .claude/agents/lessons-curator.md"
assert_true "T48: lessons-curator checks for duplicate feedback"  "grep -qi 'near-duplicate feedback\\|existing feedback memory' .claude/agents/lessons-curator.md"
assert_true "T48: lessons-curator survey order — memory first"    "[ \$(grep -nE 'MEMORY.md|CLAUDE.md.*top-level rules' .claude/agents/lessons-curator.md | head -2 | sort -n | head -1 | grep -c MEMORY) -eq 1 ]"

echo
echo "=== T49: 11 GoF pattern skills are removed (replaced by NestJS-aware adaptations) ==="
for gof in command-pattern factory-pattern flyweight-pattern mediator-pattern mixin-pattern module-pattern observer-pattern prototype-pattern provider-pattern proxy-pattern singleton-pattern; do
  assert_true "T49: $gof skill removed" "! test -d .claude/skills/$gof"
done

echo
echo "=== T50: nestjs-patterns parent skill present + 5 pattern files inside ==="
assert_true "T50: nestjs-patterns/SKILL.md exists (parent skill)" "test -f .claude/skills/nestjs-patterns/SKILL.md"
assert_true "T50: nestjs-patterns has frontmatter description"   "grep -q '^description:' .claude/skills/nestjs-patterns/SKILL.md"
assert_true "T50: nestjs-patterns description names NestJS"       "grep -q 'NestJS' .claude/skills/nestjs-patterns/SKILL.md"
assert_true "T50: nestjs-patterns has Patterns index table"       "grep -qE '^## Patterns|^## Patterns \\(index\\)' .claude/skills/nestjs-patterns/SKILL.md"
assert_true "T50: nestjs-patterns has decision tree"              "grep -qE 'Quick decision tree|Decision tree' .claude/skills/nestjs-patterns/SKILL.md"
assert_true "T50: nestjs-patterns 'NOT for' guidance"             "grep -qiE 'NOT for|When this skill does NOT fire' .claude/skills/nestjs-patterns/SKILL.md"
# 5 pattern files exist inside patterns/
for pattern in factory-providers dynamic-modules cross-cutting provider-scopes mixins; do
  assert_true "T50: nestjs-patterns/patterns/$pattern.md exists" "test -f .claude/skills/nestjs-patterns/patterns/$pattern.md"
  assert_true "T50: $pattern has 'Common LLM mistakes' section"  "grep -qiE 'LLM mistakes|Common mistakes' .claude/skills/nestjs-patterns/patterns/$pattern.md"
  assert_true "T50: $pattern cross-references repo-conventions or CLAUDE.md" "grep -qE 'repo-conventions|CLAUDE.md' .claude/skills/nestjs-patterns/patterns/$pattern.md"
done
# Old standalone skills are gone
for old in nestjs-factory-providers nestjs-dynamic-modules nestjs-cross-cutting nestjs-provider-scopes nestjs-mixins; do
  assert_true "T50: old standalone skill '$old' is removed" "! test -d .claude/skills/$old"
done

echo
echo "=== T51: nestjs-patterns content has NestJS-specific anchors (no generic GoF framing) ==="
assert_true "T51: factory-providers names useFactory:"                "grep -q 'useFactory:' .claude/skills/nestjs-patterns/patterns/factory-providers.md"
assert_true "T51: dynamic-modules names forRoot/forRootAsync"         "grep -qE 'forRoot|forRootAsync' .claude/skills/nestjs-patterns/patterns/dynamic-modules.md"
assert_true "T51: cross-cutting names Guard/Pipe/Interceptor"         "grep -qE 'Guard.*Pipe.*Interceptor|Guards, Pipes, Interceptors' .claude/skills/nestjs-patterns/patterns/cross-cutting.md"
assert_true "T51: provider-scopes names Scope.REQUEST"                "grep -q 'Scope.REQUEST' .claude/skills/nestjs-patterns/patterns/provider-scopes.md"
assert_true "T51: mixins references mixin() helper from @nestjs/common" "grep -q '@nestjs/common' .claude/skills/nestjs-patterns/patterns/mixins.md"

echo
echo "=== T52: nestjs-patterns content cites real repo files (repo-fit verification) ==="
assert_true "T52: cross-cutting cites permissions.guard.ts"               "grep -q 'permissions.guard.ts' .claude/skills/nestjs-patterns/patterns/cross-cutting.md"
assert_true "T52: cross-cutting cites permissions.decorator.ts"           "grep -q 'permissions.decorator.ts' .claude/skills/nestjs-patterns/patterns/cross-cutting.md"
assert_true "T52: mixins references the existing PermissionsGuard"        "grep -q 'PermissionsGuard' .claude/skills/nestjs-patterns/patterns/mixins.md"
assert_true "T52: provider-scopes references DatabaseService"             "grep -q 'DatabaseService' .claude/skills/nestjs-patterns/patterns/provider-scopes.md"
assert_true "T52: dynamic-modules references actual repo modules"         "grep -qE 'DatabaseModule|ProjectsModule|ChatModule|RbacModule' .claude/skills/nestjs-patterns/patterns/dynamic-modules.md"
assert_true "T52: factory-providers references ConfigService"             "grep -q 'ConfigService' .claude/skills/nestjs-patterns/patterns/factory-providers.md"

echo
echo "=== T53: Node.js reliability skills present and well-formed ==="
for skill in async-error-handling database-transactions cyclomatic-complexity; do
  assert_true "T53: $skill SKILL.md exists"               "test -f .claude/skills/$skill/SKILL.md"
  assert_true "T53: $skill has frontmatter description"   "grep -q '^description:' .claude/skills/$skill/SKILL.md"
  assert_true "T53: $skill has 'When this fires' or 'When' section" "grep -qE '^## When ' .claude/skills/$skill/SKILL.md"
  assert_true "T53: $skill has 'NOT for' / 'When this does NOT' guidance" "grep -qiE 'NOT for|When this does NOT|When NOT' .claude/skills/$skill/SKILL.md"
  assert_true "T53: $skill has 'Common LLM mistakes' section" "grep -qiE 'Common LLM mistakes|Common mistakes' .claude/skills/$skill/SKILL.md"
  assert_true "T53: $skill cross-references repo-conventions or CLAUDE.md" "grep -qE 'repo-conventions|CLAUDE.md' .claude/skills/$skill/SKILL.md"
done

echo
echo "=== T54: skills teach the right specifics (content depth check) ==="
# async-error-handling
assert_true "T54: async-error-handling teaches Promise.allSettled vs all"  "grep -q 'Promise.allSettled' .claude/skills/async-error-handling/SKILL.md"
assert_true "T54: async-error-handling teaches AbortSignal"                "grep -q 'AbortSignal' .claude/skills/async-error-handling/SKILL.md"
assert_true "T54: async-error-handling forbids retries (per CLAUDE.md P5)" "grep -qi 'no retries\\|MUST NOT.*retr\\|retries.*forbidden\\|Forbidden.*retr' .claude/skills/async-error-handling/SKILL.md"
assert_true "T54: async-error-handling catches catch-and-ignore antipattern" "grep -qiE 'catch-and-ignore|swallow' .claude/skills/async-error-handling/SKILL.md"

# database-transactions
assert_true "T54: database-transactions cites DatabaseService.transaction API" "grep -q 'DatabaseService.transaction\\|db.transaction' .claude/skills/database-transactions/SKILL.md"
assert_true "T54: database-transactions warns against this.db.query inside callback" "grep -qE 'this\\.db\\.query|outside the transaction' .claude/skills/database-transactions/SKILL.md"
assert_true "T54: database-transactions forbids HTTP inside transaction"  "grep -qi 'external.*HTTP\\|HTTP.*inside.*transaction\\|external I/O' .claude/skills/database-transactions/SKILL.md"
assert_true "T54: database-transactions covers isolation levels"          "grep -qiE 'isolation level|SERIALIZABLE|READ COMMITTED|REPEATABLE READ' .claude/skills/database-transactions/SKILL.md"

# cyclomatic-complexity
assert_true "T54: cyclomatic-complexity teaches early returns"            "grep -qi 'early return' .claude/skills/cyclomatic-complexity/SKILL.md"
assert_true "T54: cyclomatic-complexity teaches guard clauses"            "grep -qi 'guard clause' .claude/skills/cyclomatic-complexity/SKILL.md"
assert_true "T54: cyclomatic-complexity teaches extract method"           "grep -qi 'extract method' .claude/skills/cyclomatic-complexity/SKILL.md"
assert_true "T54: cyclomatic-complexity forbids 'else' after return"      "grep -qiE 'else after.*return|Eliminate .*else.*return|pointless else|dead syntax' .claude/skills/cyclomatic-complexity/SKILL.md"
assert_true "T54: cyclomatic-complexity has rough metric guidance"        "grep -qiE 'cyclomatic complexity|metric|11\\+|complexity 5' .claude/skills/cyclomatic-complexity/SKILL.md"

echo
echo "=== T55: repo-conventions logging section expanded ==="
assert_true "T55: log-level discipline table"                "grep -q 'Log-level discipline' .claude/skills/repo-conventions/SKILL.md"
assert_true "T55: explicit redaction list (passwords, tokens)" "grep -qE 'Passwords.*password.*tokens|password reset tokens|JWT bearer' .claude/skills/repo-conventions/SKILL.md"
assert_true "T55: 'What NEVER to log' section"               "grep -q 'What NEVER to log' .claude/skills/repo-conventions/SKILL.md"
assert_true "T55: correlation-without-middleware guidance"   "grep -qi 'correlation in the absence\\|no request-id middleware' .claude/skills/repo-conventions/SKILL.md"
assert_true "T55: audit vs operational logging distinction"  "grep -qi 'audit log' .claude/skills/repo-conventions/SKILL.md"

echo
echo "=== T56: CLAUDE.md and subagents are aligned to new skills (no orphans) ==="
# CLAUDE.md P3.4 mandatory matrix includes the always-fire reliability skills.
assert_true "T56: P3.4 names async-error-handling as MUST-fire"     "grep -q '| \`async-error-handling\` |' CLAUDE.md"
assert_true "T56: P3.4 names database-transactions as MUST-fire"    "grep -q '| \`database-transactions\` |' CLAUDE.md"

# CLAUDE.md Skill Pointers references the reliability skills + the consolidated nestjs-patterns.
for new_skill in async-error-handling database-transactions cyclomatic-complexity nestjs-patterns; do
  assert_true "T56: Skill Pointers row for $new_skill" "grep -q '\`$new_skill\`' CLAUDE.md"
done

# code-reviewer Required Reading covers the always-read reliability skills.
assert_true "T56: code-reviewer always-reads async-error-handling"  "grep -q 'async-error-handling/SKILL.md' .claude/agents/code-reviewer.md"
assert_true "T56: code-reviewer always-reads cyclomatic-complexity" "grep -q 'cyclomatic-complexity/SKILL.md' .claude/agents/code-reviewer.md"
assert_true "T56: code-reviewer reads database-transactions conditionally" "grep -q 'database-transactions/SKILL.md' .claude/agents/code-reviewer.md"
assert_true "T56: code-reviewer audits Promise.all/allSettled patterns"   "grep -qE 'Promise.all.*allSettled|allSettled' .claude/agents/code-reviewer.md"
assert_true "T56: code-reviewer audits transaction-wrap presence"   "grep -qE 'db.transaction|transaction.*callback|missing.*db.transaction' .claude/agents/code-reviewer.md"
assert_true "T56: code-reviewer audits no-else-after-return"        "grep -qiE 'else after.*return|nested validation pyramid' .claude/agents/code-reviewer.md"

# architect-reviewer mentions the new skills in conditional reading.
assert_true "T56: architect-reviewer mentions async-error-handling" "grep -q 'async-error-handling' .claude/agents/architect-reviewer.md"
assert_true "T56: architect-reviewer mentions database-transactions" "grep -q 'database-transactions' .claude/agents/architect-reviewer.md"

# qa-validator and security-reviewer reference the relevant new skills.
assert_true "T56: qa-validator references async-error-handling for network/partial" "grep -q 'async-error-handling' .claude/agents/qa-validator.md"
assert_true "T56: qa-validator references database-transactions for rollback testing" "grep -q 'database-transactions' .claude/agents/qa-validator.md"
assert_true "T56: security-reviewer references database-transactions"  "grep -q 'database-transactions' .claude/agents/security-reviewer.md"
assert_true "T56: security-reviewer references async-error-handling"   "grep -q 'async-error-handling' .claude/agents/security-reviewer.md"

echo
echo "=== T57: PR-review accuracy corrections (round 2-3 feedback) ==="
# CLAUDE.md P2 reflects hybrid persistence and softens MUST -> PREFER framing.
assert_true "T57: CLAUDE.md P2 establishes TypeORM-first for new modules" "grep -qiE 'prefer TypeORM|TypeORM.first|For new modules.*TypeORM' CLAUDE.md"
assert_true "T57: CLAUDE.md P2 names raw SQL as fallback with stated justification" "grep -qiE 'fallback|with stated justification|with explicit justification|only with' CLAUDE.md"
assert_true "T57: CLAUDE.md P2 uses PREFER for NestJS exceptions" "grep -qE 'PREFER NestJS.*exception|PREFER NestJS built-in exceptions' CLAUDE.md"
assert_true "T57: CLAUDE.md P2 uses PREFER for Logger"            "grep -qE 'PREFER NestJS built-in .Logger|PREFER.*Logger' CLAUDE.md"

# repo-conventions reflects reality.
assert_true "T57: repo-conventions Stack establishes TypeORM-first"          "grep -qiE 'TypeORM-first|Default for new modules: TypeORM' .claude/skills/repo-conventions/SKILL.md"
assert_true "T57: repo-conventions Repository pattern leads with TypeORM"    "grep -qE 'Default: TypeORM|TypeORM-first for new modules' .claude/skills/repo-conventions/SKILL.md"
assert_true "T57: repo-conventions has 'When to drop to raw SQL' criteria"   "grep -q 'When to drop to raw SQL' .claude/skills/repo-conventions/SKILL.md"
assert_true "T57: repo-conventions notes existing modules NOT flagged"       "grep -qiE 'NOT flagged|forward-looking' .claude/skills/repo-conventions/SKILL.md"
assert_true "T57: repo-conventions Error handling has Reality check"         "grep -q 'Reality check' .claude/skills/repo-conventions/SKILL.md"
assert_true "T57: repo-conventions DTO section accepts types OR classes"     "grep -qE 'types or classes|either TypeScript types or classes' .claude/skills/repo-conventions/SKILL.md"

# database-transactions migration claim corrected.
assert_true "T57: database-transactions notes migration runner does NOT auto-wrap" "grep -qiE 'NOT auto-wrapped|does \\*\\*NOT\\*\\* wrap|does NOT wrap each migration' .claude/skills/database-transactions/SKILL.md"
assert_true "T57: database-transactions covers TypeORM transaction API"            "grep -qE 'manager\\.transaction|dataSource\\.transaction|TypeORM transactions' .claude/skills/database-transactions/SKILL.md"
assert_true "T57: database-transactions covers raw-SQL transaction API"            "grep -q 'DatabaseService.transaction' .claude/skills/database-transactions/SKILL.md"

# db-write-protocol overclaim softened.
assert_true "T57: db-write-protocol uses 'Some catastrophic' framing"        "grep -qiE 'Some.*catastrophic|coverage is not exhaustive|Treat .permissions.deny. as a safety net' .claude/skills/db-write-protocol/SKILL.md"

# settings.json sqlite3 deny patterns expanded.
assert_true "T57: settings.json denies sqlite3 CREATE"   "grep -q 'sqlite3 \\* CREATE' .claude/settings.json"
assert_true "T57: settings.json denies sqlite3 REPLACE"  "grep -q 'sqlite3 \\* REPLACE' .claude/settings.json"
assert_true "T57: settings.json denies sqlite3 TRUNCATE" "grep -q 'sqlite3 \\* TRUNCATE' .claude/settings.json"

# Acceptance script preflight check.
assert_true "T57: acceptance script preflights required CLI tools" "grep -q 'required tool' .claude/tests/run-acceptance.sh"

# Force-added ruler-managed skills are tracked in git.
for skill in code-simplifier js-performance-patterns nestjs-best-practices nodejs-best-practices typescript-advanced-types; do
  assert_true "T57: ruler-managed skill '$skill' is git-tracked" "git ls-files --error-unmatch .claude/skills/$skill/SKILL.md > /dev/null 2>&1"
done

echo
echo "=== T58: subagents are aware of all skills (Discovery step + nestjs-best-practices coverage) ==="
# nestjs-best-practices in always-read for architect-reviewer + code-reviewer.
assert_true "T58: architect-reviewer always-reads nestjs-best-practices" "grep -q 'nestjs-best-practices/SKILL.md' .claude/agents/architect-reviewer.md"
assert_true "T58: code-reviewer always-reads nestjs-best-practices"      "grep -q 'nestjs-best-practices/SKILL.md' .claude/agents/code-reviewer.md"
# nestjs-best-practices conditionally referenced by qa-validator + security-reviewer.
assert_true "T58: qa-validator references nestjs-best-practices test rules"   "grep -q 'nestjs-best-practices' .claude/agents/qa-validator.md"
assert_true "T58: security-reviewer references nestjs-best-practices security rules" "grep -q 'nestjs-best-practices' .claude/agents/security-reviewer.md"
# code-reviewer also reads code-simplifier and typescript-advanced-types conditionally.
assert_true "T58: code-reviewer references code-simplifier"              "grep -q 'code-simplifier/SKILL.md' .claude/agents/code-reviewer.md"
assert_true "T58: code-reviewer references typescript-advanced-types"    "grep -q 'typescript-advanced-types/SKILL.md' .claude/agents/code-reviewer.md"
# Discovery step in all 4 review subagents.
for agent in architect-reviewer code-reviewer qa-validator security-reviewer; do
  assert_true "T58: $agent has Discovery step (floor not ceiling)" "grep -qE 'Discovery|floor, not the ceiling' .claude/agents/$agent.md"
done
# lessons-curator survey enumerates all skill categories explicitly.
assert_true "T58: lessons-curator survey names all skill categories" "grep -qE 'workflow skills.*reference skills.*tactical patterns|all.*workflow.*reference|enumerate' .claude/agents/lessons-curator.md"
# architect-reviewer cites the arch-* rules from nestjs-best-practices.
assert_true "T58: architect-reviewer names arch-* rules"             "grep -qE 'arch-avoid-circular-deps|arch-feature-modules|arch-\\*' .claude/agents/architect-reviewer.md"

echo
echo "=== T59: Round-9 capability improvements (verdict aggregation, attestation, workflow chains, meta-findings, fma-earlier) ==="
# 1. Verdict aggregation rule in CLAUDE.md P8.2
assert_true "T59: P8.2 Aggregating subagent confidence section present" "grep -q 'P8.2 Aggregating subagent confidence' CLAUDE.md"
assert_true "T59: aggregation uses minimum, not average"                "grep -qiE 'minimum, not.*average|min\\(model_rubric_outcome' CLAUDE.md"
assert_true "T59: BLOCK supersedes rubric arithmetic"                   "grep -qiE 'BLOCK supersedes|BLOCK.*final confidence is.*0' CLAUDE.md"

# 2. Skills-consulted attestation as P8 item 11
assert_true "T59: P8 item 11 'Skills consulted:' attestation"           "grep -qE '11\\..*Skills consulted' CLAUDE.md"
assert_true "T59: attestation forbids listing skills not actually read" "grep -qiE 'not.*list skills you only saw|do NOT list skills you only saw' CLAUDE.md"

# 3. Workflow chains section in CLAUDE.md
assert_true "T59: Workflow chains section present"                      "grep -q '^## Workflow chains' CLAUDE.md"
assert_true "T59: Workflow chain — New feature"                         "grep -q 'New feature' CLAUDE.md"
assert_true "T59: Workflow chain — Bug fix"                             "grep -qE '^\\| \\*\\*Bug fix\\*\\*' CLAUDE.md"
assert_true "T59: Workflow chain — Auth/RBAC/payments/migration"        "grep -qiE 'Auth.*RBAC.*payments|high-risk per P3.3' CLAUDE.md"
assert_true "T59: Workflow chain — Refactor"                            "grep -qE '^\\| \\*\\*Refactor' CLAUDE.md"
assert_true "T59: Workflow chain — Performance work"                    "grep -qE '^\\| \\*\\*Performance' CLAUDE.md"
assert_true "T59: Workflow chain — Async / external-integration"        "grep -qiE 'Async.*external|external-integration' CLAUDE.md"
assert_true "T59: Workflow chain — NestJS module / provider design"     "grep -qiE 'NestJS module.*provider|module / provider design' CLAUDE.md"

# 4. Meta-findings section in 4 review subagents
for agent in architect-reviewer code-reviewer qa-validator security-reviewer; do
  assert_true "T59: $agent has Meta-findings section"                       "grep -q '## Meta-findings' .claude/agents/$agent.md"
  assert_true "T59: $agent Meta-findings cites '3+ times' or 'recurring'"   "grep -qiE '3\\+ times|recurring' .claude/agents/$agent.md"
  assert_true "T59: $agent Meta-findings forbids invented findings"         "grep -qiE 'Do not invent meta-findings|do not invent meta-findings' .claude/agents/$agent.md"
done

# 5. failure-mode-analysis usable earlier in workflow
assert_true "T59: plan-mode Step 0 includes 'Anticipated failure modes'" "grep -q 'Anticipated failure modes' .claude/skills/plan-mode/SKILL.md"
assert_true "T59: failure-mode-analysis description says 'Use TWICE'"   "grep -qE 'Use TWICE|use TWICE' .claude/skills/failure-mode-analysis/SKILL.md"
assert_true "T59: failure-mode-analysis description names plan-mode Step 0" "grep -q 'plan-mode.*Step 0\\|during.*plan-mode' .claude/skills/failure-mode-analysis/SKILL.md"

echo
echo "=== T60: RLM operationalized in subagents + workflow chains + lessons-curator ==="
# Each review subagent's Read step branches on small/large change size.
for agent in architect-reviewer code-reviewer qa-validator security-reviewer; do
  assert_true "T60: $agent Read step branches on Small/Large change"  "grep -qiE 'Small change|Small plan' .claude/agents/$agent.md && grep -qiE 'Large change|Large plan' .claude/agents/$agent.md"
  assert_true "T60: $agent Read step references rlm-explore"          "grep -q 'rlm-explore' .claude/agents/$agent.md"
  assert_true "T60: $agent Read step uses LOCATE/EXTRACT/CHUNK/TRANSFORM/VERIFY" "grep -qE 'LOCATE.*EXTRACT|LOCATE:|EXTRACT:|CHUNK:|TRANSFORM:|VERIFY:' .claude/agents/$agent.md"
  # Working Set in output format.
  assert_true "T60: $agent output has Working Set section"            "grep -q '### Working Set' .claude/agents/$agent.md"
done

# CLAUDE.md workflow chains include rlm-explore for the relevant chains.
assert_true "T60: workflow chain — Bug fix dense-stack-trace uses rlm-explore"  "grep -qE 'Bug fix.*dense.*rlm-explore|dense stack trace.*rlm-explore' CLAUDE.md"
assert_true "T60: workflow chain — Performance starts with rlm-explore"         "grep -qE 'Performance.*rlm-explore.*hot path|rlm-explore.*LOCATE the hot path' CLAUDE.md"
assert_true "T60: workflow chain — Large code review row present"               "grep -qE 'Large code review|>4 files OR >500 LOC' CLAUDE.md"
assert_true "T60: workflow chain — New feature unfamiliar uses rlm-explore"     "grep -qE 'New feature.*unfamiliar|unfamiliar code.*rlm-explore' CLAUDE.md"

# lessons-curator uses LOCATE/EXTRACT instead of loading all skills.
assert_true "T60: lessons-curator survey uses LOCATE/EXTRACT pattern"           "grep -qE 'LOCATE.*EXTRACT|LOCATE — find candidates|grep the correction' .claude/agents/lessons-curator.md"
assert_true "T60: lessons-curator forbids loading all 25 skills by default"     "grep -qiE 'do not load every skill|anti-RLM and wasteful|not.*load.*25' .claude/agents/lessons-curator.md"

echo
echo "==========================="
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "Failed:$FAILED_TESTS"
  exit 1
fi
exit 0
