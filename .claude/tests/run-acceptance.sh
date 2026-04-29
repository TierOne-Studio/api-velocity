#!/usr/bin/env bash
# run-acceptance.sh — acceptance tests for the no-hooks agent profile.
# Architecture: skills + subagents + CLAUDE.md only. Permissions.deny replaces guard hooks.
# Usage: bash .claude/tests/run-acceptance.sh

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

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
echo "=== T13: CLAUDE.md size <= 2100 words (priority-structured mode — index + P0..P9 + MUST/SHOULD/MAY) ==="
WORDS=$(wc -w < CLAUDE.md | tr -d '[:space:]')
if [ "$WORDS" -le 2100 ]; then
  echo "PASS: T13 (CLAUDE.md is $WORDS words; gate is 2100 in priority-structured mode)"; PASS=$((PASS+1))
else
  echo "FAIL: T13 (CLAUDE.md is $WORDS words, expected <= 2100)"
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
  if ! printf '%s' "$desc" | grep -Eq '^Use (when|ALWAYS when|BEFORE|PROACTIVELY)'; then
    echo "FAIL: T14 $sk description does not start with 'Use when/ALWAYS when/BEFORE/PROACTIVELY' (got: ${desc:0:60})"
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
assert_true "T30: description starts 'Use BEFORE'" "echo '$FMA_DESC' | grep -q '^Use BEFORE'"
assert_true "T30: description has 'NOT for'"       "echo '$FMA_DESC' | grep -q 'NOT for'"
assert_true "T30: lists 8 categories"              "grep -Ec '^### [0-9]\\.' .claude/skills/failure-mode-analysis/SKILL.md | grep -q '^8$'"

echo
echo "=== T31: code-reviewer narrowed (design-only, delegates) ==="
assert_true "T31: description names DESIGN principles only" "grep -q 'DESIGN' .claude/agents/code-reviewer.md"
assert_true "T31: delegates to qa-validator"                "grep -q 'qa-validator' .claude/agents/code-reviewer.md"
assert_true "T31: delegates to security-reviewer"           "grep -q 'security-reviewer' .claude/agents/code-reviewer.md"
assert_true "T31: NO 'what TDD missed' section in body"    "! grep -q 'what TDD missed' .claude/agents/code-reviewer.md"

echo
echo "=== T32: design-review has calibration rubric ==="
assert_true "T32: 'Confidence calibration rubric' present"   "grep -q 'Confidence calibration rubric' .claude/skills/design-review/SKILL.md"
assert_true "T32: 5 rubric items (each worth 0.20)"          "[ \$(grep -c '0.20 / 0.20\\|| 0.20 |' .claude/skills/design-review/SKILL.md) -ge 5 ]"

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
assert_true "T38: 'Repository pattern (raw SQL'"      "grep -qi 'Repository pattern (raw SQL' .claude/skills/repo-conventions/SKILL.md"
assert_true "T38: 'Projects + multi-source chat'"     "grep -qi 'multi-source chat' .claude/skills/repo-conventions/SKILL.md"
assert_true "T38: 'Repo-specific anti-patterns'"      "grep -qi 'Repo-specific anti-patterns' .claude/skills/repo-conventions/SKILL.md"
assert_true "T38: NestJS Logger (not pino) noted"    "grep -qi 'NestJS.*Logger' .claude/skills/repo-conventions/SKILL.md"
assert_true "T38: NOT TypeORM noted"                 "grep -qi 'NOT TypeORM' .claude/skills/repo-conventions/SKILL.md"

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
echo "==========================="
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "Failed:$FAILED_TESTS"
  exit 1
fi
exit 0
