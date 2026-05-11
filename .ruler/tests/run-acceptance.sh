#!/usr/bin/env bash
# run-acceptance.sh — acceptance tests for the no-hooks agent profile.
# Architecture: skills + subagents + CLAUDE.md only. Permissions.deny replaces guard hooks.
# Usage: bash .claude/tests/run-acceptance.sh

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

# Preflight: required CLI tools. The script uses bash, grep, awk, sed, find, wc — all POSIX-standard.
# jq is needed for JSON-parsing assertions (Python sometimes used as fallback elsewhere; not here).
for tool in bash grep awk sed find wc jq; do
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
echo "=== T13: CLAUDE.md size <= 3350 words (priority-structured mode — index + P0..P9 + MUST/SHOULD/MAY + inline rubric + P3.5 skill-vs-repo conflict resolution) ==="
WORDS=$(wc -w < CLAUDE.md | tr -d '[:space:]')
if [ "$WORDS" -le 3350 ]; then
  echo "PASS: T13 (CLAUDE.md is $WORDS words; gate is 3350 to accommodate inline confidence rubric, high-risk restate, and P3.5 conflict-resolution rule)"; PASS=$((PASS+1))
else
  echo "FAIL: T13 (CLAUDE.md is $WORDS words, expected <= 3350)"
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
# Ruler emits tools as a multi-line YAML list ("tools:\n  - Read\n  - Grep").
# Older inline form ("tools: Read, Grep") may still appear in hand-edited drafts.
# This awk captures BOTH: the tail of the inline form OR each "  - <tool>" line until
# the next top-level key. Then we join into a single space-separated string for grep.
tools_for_agent() {
  awk '
    /^tools:/ {
      sub(/^tools:[[:space:]]*/,"")
      if ($0 != "") inline=$0
      intools=1
      next
    }
    intools && /^  *- / {
      sub(/^  *- */,"")
      list = list " " $0
      next
    }
    intools && /^[a-zA-Z]/ { exit }
    END { print inline " " list }
  ' "$1"
}
LC_TOOLS=$(tools_for_agent .claude/agents/lessons-curator.md)
CR_TOOLS=$(tools_for_agent .claude/agents/code-reviewer.md)
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
AR_TOOLS=$(tools_for_agent .claude/agents/architect-reviewer.md)
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
QA_TOOLS=$(tools_for_agent .claude/agents/qa-validator.md)
assert_true "T28: description starts 'Use ALWAYS'" "echo '$QA_DESC' | grep -q '^Use ALWAYS'"
assert_true "T28: description has 'NOT for'"       "echo '$QA_DESC' | grep -q 'NOT for'"
assert_true "T28: tools has Bash"                  "echo '$QA_TOOLS' | grep -q Bash"
assert_true "T28: tools NO Edit"                   "! echo '$QA_TOOLS' | grep -wq Edit"
assert_true "T28: tools NO Write"                  "! echo '$QA_TOOLS' | grep -wq Write"
assert_true "T28: emits PASS verdict"              "grep -q '^.*PASS.*GAPS.*BLOCK' .claude/agents/qa-validator.md"

echo
echo "=== T29: security-reviewer subagent well-formed ==="
SR_DESC=$(awk '/^description:/{sub(/^description:[[:space:]]*/,""); print; exit}' .claude/agents/security-reviewer.md)
SR_TOOLS=$(tools_for_agent .claude/agents/security-reviewer.md)
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
assert_true "T37: '@RequirePermissions' lives in repo-conventions (per T74 layered-router; CLAUDE.md no longer cites code symbols)" \
  "grep -q '@RequirePermissions' .claude/skills/repo-conventions/SKILL.md"
assert_true "T37: 'organization_id' query rule lives in repo-conventions" \
  "grep -q 'organization_id' .claude/skills/repo-conventions/SKILL.md"
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
assert_true "T57: NestJS built-in exceptions convention lives in repo-conventions (per T74 layered-router)" \
  "grep -qE 'NestJS built-in exceptions|NotFoundException' .claude/skills/repo-conventions/SKILL.md"
assert_true "T57: NestJS Logger convention lives in repo-conventions (per T74 layered-router)" \
  "grep -qE 'NestJS .Logger|new Logger\\(' .claude/skills/repo-conventions/SKILL.md"

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
echo "=== T61: nestjs-best-practices rules use ASKS-FIRST structure (no silent dep installs) ==="
# Skill index documents the asks-first convention.
assert_true "T61: SKILL.md prelude documents 'How rules are structured'"      "grep -q 'How rules in this skill are structured' .claude/skills/nestjs-best-practices/SKILL.md"
assert_true "T61: SKILL.md describes Approach A vs Approach B framing"        "grep -qiE 'Approach A.*Approach B|Custom abstraction.*Library|Approach gate' .claude/skills/nestjs-best-practices/SKILL.md"
assert_true "T61: SKILL.md lists 11 asks-first / P3.5 rules"                  "grep -qiE '11 rules currently document|Tier' .claude/skills/nestjs-best-practices/SKILL.md"

# Each of 9 rules has the asks-first structure.
ASKS_FIRST_RULES="devops-use-logging security-validate-all-input arch-use-events di-scope-awareness devops-use-config-module db-avoid-n-plus-one micro-use-health-checks security-sanitize-output micro-use-queues"
for rule in $ASKS_FIRST_RULES; do
  f=".claude/skills/nestjs-best-practices/rules/$rule.md"
  assert_true "T61: $rule has 'Approach gate' callout"                  "grep -q 'Approach gate' $f"
  assert_true "T61: $rule asks user 'Before writing any code, ASK'"     "grep -qiE 'ASK the user|Before writing any code, ASK|Before adopting|ASK the user' $f"
  assert_true "T61: $rule has 'Outcome' section"                        "grep -q '^## Outcome' $f"
  assert_true "T61: $rule names 'Adoption-gated' on the dep section OR ask-only framing" "grep -qiE 'Adoption-gated|Approach B|Tier 3|adoption-gated|adopting.*requires' $f"
done

# Tiers 1+2 (non-queues) have an Approach A — Custom abstraction (no new deps) section.
TIER12_RULES="devops-use-logging security-validate-all-input arch-use-events di-scope-awareness devops-use-config-module db-avoid-n-plus-one micro-use-health-checks security-sanitize-output"
for rule in $TIER12_RULES; do
  f=".claude/skills/nestjs-best-practices/rules/$rule.md"
  assert_true "T61: $rule offers Approach A (no new deps)"              "grep -qE 'Approach A.*[Cc]ustom abstraction|no new deps' $f"
done

# Tier 3 (queues) explicitly says no clean abstraction exists.
assert_true "T61: micro-use-queues marks Tier 3 (no clean abstraction)" "grep -qiE 'Tier 3|no clean abstraction|no abstraction' .claude/skills/nestjs-best-practices/rules/micro-use-queues.md"

# T0 preflight includes jq (defensive fix).
assert_true "T61: T0 preflight includes jq"                             "grep -q 'for tool in.*jq' .claude/tests/run-acceptance.sh"

echo
echo "=== T62: skill-vs-repo conflict resolution rule (P3.5) wired in main + subagents + non-dep rule ==="
# CLAUDE.md P3.5 present
assert_true "T62: CLAUDE.md P3.5 section header present"               "grep -q 'P3.5 Skill-vs-repo conflict resolution' CLAUDE.md"
assert_true "T62: P3.5 names default-to-skill"                         "grep -qE 'Default:.*follow the skill recommendation|follow the skill recommendation' CLAUDE.md"
assert_true "T62: P3.5 names structural-refactor exception"            "grep -qE 'structural refactor|cross-cutting infra the repo lacks' CLAUDE.md"
assert_true "T62: P3.5 instructs to recommend a future task"           "grep -qE 'Future task|recommend a future task|recommend.*future task' CLAUDE.md"
assert_true "T62: P3.5 lists examples of NOT structural"               "grep -qiE 'What is NOT structural|best practice wins, no exception' CLAUDE.md"

# Each of 4 review subagents has the conflict-resolution line referencing P3.5
for agent in code-reviewer architect-reviewer qa-validator security-reviewer; do
  assert_true "T62: $agent references P3.5 conflict-resolution rule" "grep -q 'CLAUDE.md.*P3.5\\|P3.5.*conflict' .claude/agents/$agent.md"
  assert_true "T62: $agent says structural -> repo wins for current PR" "grep -qiE 'repo wins|follow the repo|repo convention.*PR' .claude/agents/$agent.md"
done

# error-use-exception-filters.md restructured under the meta-rule
assert_true "T62: error-use-exception-filters references P3.5"         "grep -q 'P3.5' .claude/skills/nestjs-best-practices/rules/error-use-exception-filters.md"
assert_true "T62: error-use-exception-filters has Outcome section"     "grep -q '^## Outcome' .claude/skills/nestjs-best-practices/rules/error-use-exception-filters.md"
assert_true "T62: error-use-exception-filters has Approach A (no global filter)" "grep -qE 'Approach A.*no global filter|Approach A.*Throw NestJS' .claude/skills/nestjs-best-practices/rules/error-use-exception-filters.md"
assert_true "T62: error-use-exception-filters marks Approach B as Structural refactor" "grep -qE 'Structural refactor|structural change to the repo' .claude/skills/nestjs-best-practices/rules/error-use-exception-filters.md"
assert_true "T62: error-use-exception-filters tells agent to ASK user" "grep -qiE 'ASK the user|Wait for explicit response' .claude/skills/nestjs-best-practices/rules/error-use-exception-filters.md"

echo
echo "=== T63: security-reviewer dep-gate audit (Step 2.5) ==="
SR=".claude/agents/security-reviewer.md"
assert_true "T63: security-reviewer has '2.5. Dependency-gate audit' section" \
  "grep -q '### 2.5. Dependency-gate audit' $SR"
assert_true "T63: section cites P0.2/P0.3 approval gate"                       \
  "grep -qE 'P0.2/P0.3|P0\\.2.*P0\\.3' $SR"
assert_true "T63: section instructs git diff package.json check"               \
  "grep -q 'git diff.*package.json' $SR"
assert_true "T63: section searches for 'Awaiting approval' phrase"             \
  "grep -q \"Awaiting approval\" $SR"
assert_true "T63: section has finding rubric with HIGH for missing evidence"   \
  "grep -qE 'NO approval evidence.*HIGH|HIGH.*NO approval evidence' $SR"
assert_true "T63: section has CRITICAL for security-sensitive dep + no evidence" \
  "grep -qiE 'security-sensitive.*CRITICAL|CRITICAL.*security-sensitive' $SR"
assert_true "T63: section cross-checks against nestjs-best-practices asks-first" \
  "grep -q 'asks-first' $SR"
assert_true "T63: A06 OWASP row references Step 2.5"                           \
  "grep -q 'A06.*Step 2.5' $SR"
assert_true "T63: Output format has 'Dependency gate audit' block"             \
  "grep -q '### Dependency gate audit' $SR"

echo
echo "=== T64: skill-loading simulation script present and green ==="
assert_true "T64: simulate-prompts.sh exists"     "test -f .claude/tests/simulate-prompts.sh"
assert_true "T64: simulate-prompts.sh executable" "test -x .claude/tests/simulate-prompts.sh"
# Run simulation as a subassertion. All cases must pass.
if bash .claude/tests/simulate-prompts.sh >/tmp/sim-prompts.log 2>&1; then
  echo "PASS: T64 simulation passed (see /tmp/sim-prompts.log)"; PASS=$((PASS+1))
else
  echo "FAIL: T64 simulation FAILED — see /tmp/sim-prompts.log:"
  tail -20 /tmp/sim-prompts.log
  FAIL=$((FAIL+1)); FAILED_TESTS="$FAILED_TESTS T64"
fi
# Structural assertions on the simulation file.
assert_true "T64: simulation defines run_case helper"       "grep -q 'run_case()' .claude/tests/simulate-prompts.sh"
assert_true "T64: simulation defines workflow-chain helper" "grep -q 'check_workflow_chain_mentions' .claude/tests/simulate-prompts.sh"
assert_true "T64: simulation notes mandatory P3.4 exemption" "grep -q 'P3.4' .claude/tests/simulate-prompts.sh"

echo
echo "=== T65: PR-feedback fixes (5 items from 2026-04-30 review) ==="

# Item 5 — settings.json deny patterns cover non-colon main/master push + rebase -i.
SJ=".claude/settings.json"
assert_true "T65: deny pattern 'git push * main' (no colon)"        "grep -q 'git push \\* main)' $SJ"
assert_true "T65: deny pattern 'git push * master' (no colon)"      "grep -q 'git push \\* master)' $SJ"
assert_true "T65: deny pattern 'git push * *:main' (force-form)"    "grep -q 'git push \\* \\*:main)' $SJ"
assert_true "T65: deny pattern 'git push * *:master' (force-form)"  "grep -q 'git push \\* \\*:master)' $SJ"
assert_true "T65: deny pattern 'git push * :main' (delete refspec)" "grep -q 'git push \\* :main)' $SJ"
assert_true "T65: deny pattern 'git push * :master' (delete)"       "grep -q 'git push \\* :master)' $SJ"
assert_true "T65: deny pattern 'git push origin main' (no colon)"   "grep -q 'git push origin main)' $SJ"
assert_true "T65: deny pattern 'git push origin master' (no colon)" "grep -q 'git push origin master)' $SJ"
assert_true "T65: deny pattern 'git push -u origin main' (no colon)"   "grep -q 'git push -u origin main)' $SJ"
assert_true "T65: deny pattern 'git push -u origin master' (no colon)" "grep -q 'git push -u origin master)' $SJ"
assert_true "T65: deny pattern 'git rebase -i main' (no colon)"     "grep -q 'git rebase -i main)' $SJ"
assert_true "T65: deny pattern 'git rebase -i master' (no colon)"   "grep -q 'git rebase -i master)' $SJ"

# Item 4 — decision-rules § 6 aligned with P3.5.
DR=".claude/skills/decision-rules/SKILL.md"
assert_true "T65: decision-rules § 6 default is follow-the-skill"   "grep -q 'Follow the skill when it applies' $DR"
assert_true "T65: decision-rules § 6 names structural-refactor override" \
  "grep -qE 'structural change to the repo|cross-cutting infrastructure|installing a new dependency' $DR"
assert_true "T65: decision-rules § 6 cross-references CLAUDE.md P3.5" \
  "grep -q 'mirror of CLAUDE.md P3.5\\|CLAUDE.md P3.5' $DR"
# Negative — old "CLAUDE.md wins. Skills are situational" wording must be gone.
assert_true "T65: decision-rules § 6 no longer says 'CLAUDE.md wins. Skills are situational'" \
  "! grep -qE 'CLAUDE\\.md wins\\. Skills are situational' $DR"

# Item 1 — security-use-guards restructured under P3.5.
SUG=".claude/skills/nestjs-best-practices/rules/security-use-guards.md"
assert_true "T65: security-use-guards references P3.5"              "grep -q 'P3.5' $SUG"
assert_true "T65: security-use-guards has Approach gate ASK FIRST"  "grep -q '## Approach gate (ASK FIRST)' $SUG"
assert_true "T65: security-use-guards Approach A is route-level"    "grep -qE 'Approach A.*Route-level|Route-level.*Approach A' $SUG"
assert_true "T65: security-use-guards Approach B is APP_GUARD structural" \
  "grep -qE 'Approach B.*APP_GUARD|APP_GUARD.*Structural refactor' $SUG"
assert_true "T65: security-use-guards has Outcome section"          "grep -q '^## Outcome' $SUG"
assert_true "T65: security-use-guards adoption checklist"           "grep -q 'Adoption checklist' $SUG"

# Item 2 — perf-use-caching restructured under asks-first.
PUC=".claude/skills/nestjs-best-practices/rules/perf-use-caching.md"
assert_true "T65: perf-use-caching references P3.5"                 "grep -q 'P3.5' $PUC"
assert_true "T65: perf-use-caching has Approach gate ASK FIRST"     "grep -q '## Approach gate (ASK FIRST)' $PUC"
assert_true "T65: perf-use-caching Approach A is in-process (no deps)" \
  "grep -qE 'Approach A.*[Ii]n-process|no new deps|no deps' $PUC"
assert_true "T65: perf-use-caching Approach B names KeyvRedis"      "grep -q 'KeyvRedis\\|@keyv/redis' $PUC"
assert_true "T65: perf-use-caching has Outcome section"             "grep -q '^## Outcome' $PUC"
assert_true "T65: perf-use-caching adoption checklist"              "grep -q 'Adoption checklist' $PUC"

# Item 3 — nestjs-best-practices SKILL.md prelude softened + 11-rule table.
NBP=".claude/skills/nestjs-best-practices/SKILL.md"
assert_true "T65: SKILL.md prelude softens 'never silently' to 'intended to avoid'" \
  "grep -q 'intended to.*avoid silently introducing new dependencies' $NBP"
assert_true "T65: SKILL.md prelude tells agent 'do not assume a dependency can be added without user confirmation'" \
  "grep -qE 'do not assume a dependency can be added without user confirmation' $NBP"
assert_true "T65: SKILL.md prelude lists 11 rules"                  "grep -q '11 rules currently document' $NBP"
assert_true "T65: SKILL.md table includes perf-use-caching row"     "grep -q '\\\`perf-use-caching\\\`' $NBP"
assert_true "T65: SKILL.md table includes security-use-guards row"  "grep -q '\\\`security-use-guards\\\`' $NBP"
assert_true "T65: SKILL.md prelude references P3.5 framing"         "grep -q 'P3.5' $NBP"

echo
echo "=== T66: no-AI-attribution rule wired in CLAUDE.md P0.1 + git-workflow ==="
# CLAUDE.md P0.1 has the author-attribution rule.
assert_true "T66: CLAUDE.md P0.1 has 'Author attribution' bullet" \
  "grep -q 'Author attribution' CLAUDE.md"
assert_true "T66: CLAUDE.md forbids 'Co-Authored-By: Claude' trailer" \
  "grep -qE 'Co-Authored-By: Claude' CLAUDE.md"
assert_true "T66: CLAUDE.md forbids 'Generated with [Claude Code]' footer" \
  "grep -qE '\\\[Claude Code\\\]|Generated with' CLAUDE.md"
assert_true "T66: CLAUDE.md says 'overrides any tool default'" \
  "grep -qE 'overrides any tool default' CLAUDE.md"
assert_true "T66: CLAUDE.md scopes rule to commits/PRs/issues/releases" \
  "grep -qE 'commit messages.*PR.*issue|PR descriptions|release notes' CLAUDE.md"

# git-workflow SKILL.md restates the rule (tactical reminder at the moment of action).
GW=".claude/skills/git-workflow/SKILL.md"
assert_true "T66: git-workflow has 'Author attribution — no AI signatures' rule" \
  "grep -q 'Author attribution' $GW"
assert_true "T66: git-workflow forbids 'Co-Authored-By: Claude'"     "grep -q 'Co-Authored-By: Claude' $GW"
assert_true "T66: git-workflow cross-references CLAUDE.md P0.1"      "grep -q 'CLAUDE.md.*P0.1\\|P0.1' $GW"
assert_true "T66: git-workflow Hard rules section is plural (2 rules now)" \
  "grep -q '^## Hard rules' $GW"

# Defensive: this commit's own message should NOT include the forbidden TRAILER.
# Anchor to start-of-line — actual trailers are line-prefixed; quoted mentions
# of the forbidden strings inside prose (e.g., a commit body explaining the
# rule) are intentionally allowed.
assert_true "T66: HEAD commit has no 'Co-Authored-By: Claude' trailer line" \
  "! git log -1 --format='%B' | grep -qE '^Co-Authored-By:[[:space:]]*Claude'"
assert_true "T66: HEAD commit has no '🤖 Generated with [Claude Code]' footer line" \
  "! git log -1 --format='%B' | grep -qE '^🤖 Generated with \\[Claude Code\\]'"

echo
echo "=== T67: ADR scaffolding + documentation-and-adrs skill + plan-mode slice cap ==="

# ADR directory + index + template
assert_true "T67: docs/decisions/ directory exists"             "test -d docs/decisions"
assert_true "T67: docs/decisions/README.md is the index"        "test -f docs/decisions/README.md"
assert_true "T67: index README has 'Architecture Decision Records' header" \
  "grep -q 'Architecture Decision Records' docs/decisions/README.md"
assert_true "T67: index README has the index table"             "grep -q '^| # | Title | Status | Date |' docs/decisions/README.md"
assert_true "T67: index README has 'How skills/agents reference ADRs' section" \
  "grep -q 'How skills/agents reference ADRs' docs/decisions/README.md"
assert_true "T67: docs/decisions/_template.md present"          "test -f docs/decisions/_template.md"
assert_true "T67: template has all required sections" \
  "grep -q '^## Context$' docs/decisions/_template.md && grep -q '^## Decision$' docs/decisions/_template.md && grep -q '^## Alternatives considered$' docs/decisions/_template.md && grep -q '^## Consequences$' docs/decisions/_template.md && grep -q '^## References$' docs/decisions/_template.md"

# 8 retrospective ADRs present and well-formed
ADRS="ADR-001-typeorm-first-persistence ADR-002-rbac-scope-all-returns-400 ADR-003-no-global-exception-filter ADR-004-nestjs-logger-no-pino ADR-005-no-class-validator-no-validation-pipe ADR-006-asks-first-dep-gate ADR-007-skill-vs-repo-conflict-resolution ADR-008-no-ai-attribution"
for adr in $ADRS; do
  f="docs/decisions/$adr.md"
  assert_true "T67: $adr.md exists"                             "test -f $f"
  assert_true "T67: $adr.md has Status line"                    "grep -qE '^\\*\\*Status:\\*\\*' $f"
  assert_true "T67: $adr.md has Date line"                      "grep -qE '^\\*\\*Date:\\*\\*' $f"
  assert_true "T67: $adr.md has Context section"                "grep -q '^## Context$' $f"
  assert_true "T67: $adr.md has Decision section"               "grep -q '^## Decision$' $f"
  assert_true "T67: $adr.md has Alternatives considered"        "grep -q '^## Alternatives considered$' $f"
  assert_true "T67: $adr.md has Consequences section"           "grep -q '^## Consequences$' $f"
  assert_true "T67: $adr.md has References section"             "grep -q '^## References$' $f"
done

# Index references each ADR
for adr in $ADRS; do
  assert_true "T67: index README links to $adr"                 "grep -q '$adr' docs/decisions/README.md"
done

# documentation-and-adrs skill
DA=".claude/skills/documentation-and-adrs/SKILL.md"
assert_true "T67: documentation-and-adrs skill exists"          "test -f $DA"
assert_true "T67: skill has YAML frontmatter"                   "head -1 $DA | grep -q '^---$'"
assert_true "T67: skill description starts with 'Use when'"     "grep -m1 '^description:' $DA | grep -q 'Use when'"
assert_true "T67: skill description has 'NOT for' clause"       "grep -m1 '^description:' $DA | grep -q 'NOT for'"
assert_true "T67: skill explains 'When this skill fires'"       "grep -q '## When this skill fires' $DA"
assert_true "T67: skill explains citation pattern (✅/❌)"        "grep -qE '✅|❌' $DA"
assert_true "T67: skill links to docs/decisions/ template"      "grep -q '_template.md' $DA"
assert_true "T67: skill names append-only discipline"           "grep -qi 'append-only' $DA"

# CLAUDE.md wiring
assert_true "T67: CLAUDE.md Skill Pointers row for documentation-and-adrs" \
  "grep -q 'documentation-and-adrs' CLAUDE.md"
assert_true "T67: CLAUDE.md Workflow chains has 'Structural decision' row" \
  "grep -q 'Structural decision' CLAUDE.md"

# repo-conventions cites ADRs
RC=".claude/skills/repo-conventions/SKILL.md"
assert_true "T67: repo-conventions has ADR-backed conventions table" \
  "grep -q 'ADR-backed conventions' $RC"
assert_true "T67: repo-conventions cites ADR-001"               "grep -q 'ADR-001' $RC"
assert_true "T67: repo-conventions cites ADR-003"               "grep -q 'ADR-003' $RC"
assert_true "T67: repo-conventions cites ADR-005"               "grep -q 'ADR-005' $RC"

# plan-mode slice cap
PM=".claude/skills/plan-mode/SKILL.md"
assert_true "T67: plan-mode has 'Step sizing' header (renamed to tracer-bullet in T69)" \
  "grep -qE 'Step sizing.*(thin|tracer-bullet) vertical slices' $PM"
assert_true "T67: plan-mode names ~100 LOC cap"                 "grep -qE '~100 LOC|≤ ~100 LOC' $PM"
assert_true "T67: plan-mode has 'STOP, commit, split' rule"     "grep -qiE 'STOP.*commit.*split|stop and commit|commit what.s working' $PM"
assert_true "T67: plan-mode adds 'slice:' to per-step format"   "grep -q 'slice: <expected LOC' $PM"

echo
echo "=== T68: ADR enforcement layer (subagents + adoption checklists + decision-rules + plan-mode + tdd-workflow) ==="

# Architect-reviewer ADR awareness
AR=".claude/agents/architect-reviewer.md"
assert_true "T68: architect-reviewer Required reading lists documentation-and-adrs" \
  "grep -q '.claude/skills/documentation-and-adrs/SKILL.md' $AR"
assert_true "T68: architect-reviewer compliance audit has 'ADR audit' bullet" \
  "grep -q 'ADR audit' $AR"
assert_true "T68: architect-reviewer flags missing ADR step as HIGH/MED" \
  "grep -qE 'Missing ADR step is a \\*\\*HIGH\\*\\*|MED.*load-bearing' $AR"
assert_true "T68: architect-reviewer flags ADR contradiction as HIGH" \
  "grep -qE 'silent contradiction is \\*\\*HIGH\\*\\*|contradicts an existing Accepted ADR' $AR"

# Code-reviewer ADR awareness
CR=".claude/agents/code-reviewer.md"
assert_true "T68: code-reviewer Required reading lists documentation-and-adrs" \
  "grep -q '.claude/skills/documentation-and-adrs/SKILL.md' $CR"
assert_true "T68: code-reviewer compliance audit has 'ADR audit' bullet" \
  "grep -q 'ADR audit' $CR"
assert_true "T68: code-reviewer flags missing ADR for structural change as HIGH" \
  "grep -qE 'Missing ADR for a structural change = \\*\\*HIGH\\*\\*' $CR"
assert_true "T68: code-reviewer flags ADR contradiction as HIGH" \
  "grep -qE 'contradicts an existing Accepted ADR' $CR"

# Adoption checklists in 2 P3.5 rules add the ADR step
EUF=".claude/skills/nestjs-best-practices/rules/error-use-exception-filters.md"
SUG=".claude/skills/nestjs-best-practices/rules/security-use-guards.md"
assert_true "T68: error-use-exception-filters adoption step writes ADR" \
  "grep -qE 'docs/decisions/ADR-NNN-global-exception-filter|Write \\\`docs/decisions/' $EUF"
assert_true "T68: error-use-exception-filters marks ADR-003 superseded" \
  "grep -q 'ADR-003.*Superseded by ADR-NNN' $EUF"
assert_true "T68: security-use-guards adoption step writes ADR" \
  "grep -qE 'docs/decisions/ADR-NNN-app-guard|Write \\\`docs/decisions/' $SUG"
assert_true "T68: security-use-guards adoption step references documentation-and-adrs" \
  "grep -q 'documentation-and-adrs' $SUG"

# decision-rules § 6 ADR coupling
DR=".claude/skills/decision-rules/SKILL.md"
assert_true "T68: decision-rules § 6 has 'ADR coupling' bullet" \
  "grep -q 'ADR coupling' $DR"
assert_true "T68: decision-rules § 6 names 'write ADR-NNN'"             "grep -qE 'write ADR-NNN|ADR-NNN documenting the rationale' $DR"

# plan-mode introduces structural-decision ADR step
PM=".claude/skills/plan-mode/SKILL.md"
assert_true "T68: plan-mode has 'When the plan introduces a structural decision' header" \
  "grep -q 'When the plan introduces a structural decision' $PM"
assert_true "T68: plan-mode tells engineer to write ADR step"           "grep -qE 'docs/decisions/ADR-NNN|write the corresponding ADR' $PM"
assert_true "T68: plan-mode references documentation-and-adrs skill"    "grep -q 'documentation-and-adrs' $PM"

# tdd-workflow waiver list now includes ADR-only
TW=".claude/skills/tdd-workflow/SKILL.md"
assert_true "T68: tdd-workflow waiver list says 'four valid' (was three)" \
  "grep -q 'only four valid' $TW"
assert_true "T68: tdd-workflow lists 'ADR-only change' waiver"          "grep -q 'TDD waived — ADR-only change' $TW"

# CLAUDE.md P3.1 valid-reasons list updated
assert_true "T68: CLAUDE.md P3.1 valid-reasons list includes 'ADR-only change'" \
  "grep -q '\`ADR-only change\`' CLAUDE.md"

echo
echo "=== T69: complementary additions inspired by mattpocock/skills ==="

# tdd-workflow — horizontal-vs-vertical anti-pattern + rename diagnostic + SDK-style mocking + tracer-bullet framing + 4-waiver count
TW=".claude/skills/tdd-workflow/SKILL.md"
assert_true "T69: tdd-workflow names horizontal-slicing anti-pattern" \
  "grep -qE 'Anti-pattern: horizontal slicing|DO NOT write all tests first' $TW"
assert_true "T69: tdd-workflow includes the WRONG vs RIGHT diagram"            "grep -q 'WRONG (horizontal)' $TW && grep -q 'RIGHT (vertical' $TW"
assert_true "T69: tdd-workflow rubric item 1 includes rename-test diagnostic"  "grep -q 'rename test' $TW"
assert_true "T69: tdd-workflow rubric item 7 has 'Mock at system boundaries only' rule" \
  "grep -q 'Mock at system boundaries only' $TW"
assert_true "T69: tdd-workflow rubric item 7 has 'SDK-style interfaces' guidance" \
  "grep -q 'SDK-style interfaces' $TW"
assert_true "T69: tdd-workflow Step 1 says 'You can.t test everything'"        "grep -qE \"You can.t test everything\" $TW"
assert_true "T69: tdd-workflow Step 1 renamed to 'tracer bullet'"              "grep -qE 'Step 1 — Failing test FIRST .tracer bullet|tracer bullet.' $TW"

# bug-investigation — Phase 1 feedback-loop catalog + Phase 3 ranked-falsifiable + Phase 3.5 instrument
BI=".claude/skills/bug-investigation/SKILL.md"
assert_true "T69: bug-investigation Step 1 renamed to 'Build a feedback loop'" \
  "grep -q 'Step 1 — Build a feedback loop' $BI"
assert_true "T69: bug-investigation lists 10 ranked loop construction options" \
  "grep -q '^10.' $BI"
assert_true "T69: bug-investigation says 'Treat the loop as a product'"        "grep -q 'treat it as a product' $BI"
assert_true "T69: bug-investigation Step 3 requires 3-5 ranked hypotheses"     "grep -qE 'ranked hypotheses' $BI"
assert_true "T69: bug-investigation Step 3 requires falsifiability"            "grep -qE 'falsifiable|falsified' $BI"
assert_true "T69: bug-investigation Step 3 says 'Show the ranked list to the user'" \
  "grep -q 'Show the ranked list to the user' $BI"
assert_true "T69: bug-investigation Step 3.5 requires one-variable-at-a-time"  "grep -q 'Change one variable at a time' $BI"

# design-review — deletion test + adapter rule
DR=".claude/skills/design-review/SKILL.md"
assert_true "T69: design-review YAGNI section adds Deletion test"              "grep -q 'Deletion test' $DR"
assert_true "T69: design-review adds one/two-adapter rule"                     "grep -qE 'One/two-adapter rule|hypothetical seam' $DR"

# plan-mode — grill-me mode + tracer-bullet rename
PM=".claude/skills/plan-mode/SKILL.md"
assert_true "T69: plan-mode adds 'Grill-me mode' escape hatch"                 "grep -q 'Grill-me mode' $PM"
assert_true "T69: plan-mode grill-me requires one-question-at-a-time"          "grep -qE 'one question at a time'  $PM"
assert_true "T69: plan-mode grill-me provides recommended answer per question" "grep -q 'provide your recommended answer' $PM"
assert_true "T69: plan-mode renames slice cap to 'tracer-bullet'"              "grep -q 'tracer-bullet vertical slices' $PM"

# meta-skill-hygiene — 500-LOC split rule
MSH=".claude/skills/meta-skill-hygiene/SKILL.md"
assert_true "T69: meta-skill-hygiene names ~500-line split threshold"          "grep -q '~500-line split threshold' $MSH"
assert_true "T69: meta-skill-hygiene shows split layout (REFERENCE/EXAMPLES/patterns)" \
  "grep -q 'REFERENCE.md' $MSH && grep -q 'EXAMPLES.md' $MSH && grep -q 'patterns/' $MSH"
assert_true "T69: meta-skill-hygiene cites nestjs-patterns as canonical example" \
  "grep -q 'nestjs-patterns' $MSH"

# repo-conventions — Domain glossary section
RC=".claude/skills/repo-conventions/SKILL.md"
assert_true "T69: repo-conventions has '0. Domain glossary' section"           "grep -q '## 0. Domain glossary' $RC"
assert_true "T69: glossary defines Organization"                               "grep -qE '\\*\\*Organization\\*\\*' $RC"
assert_true "T69: glossary defines Scope"                                      "grep -qE '\\*\\*Scope\\*\\*' $RC"
assert_true "T69: glossary defines Project + Source"                           "grep -qE '\\*\\*Project\\*\\*' $RC && grep -qE '\\*\\*Source\\*\\*' $RC"
assert_true "T69: glossary disambiguates 'Agent' (chat vs code)"               "grep -qE 'chat agent.*code agent|code agent' $RC"

echo
echo "=== T70: complementary additions inspired by addyosmani/agent-skills ==="

# code-simplifier — When-NOT + Chesterton's Fence + over-simplification traps
CSI=".claude/skills/code-simplifier/SKILL.md"
assert_true "T70: code-simplifier adds 'When NOT to use' section"          "grep -q '^## When NOT to use' $CSI"
assert_true "T70: code-simplifier has Chesterton's Fence pre-touch checklist" "grep -q \"Chesterton's Fence\" $CSI"
assert_true "T70: code-simplifier names over-simplification traps"          "grep -q 'Over-simplification traps' $CSI"
assert_true "T70: code-simplifier names 'Inlining too aggressively' trap"   "grep -q 'Inlining too aggressively' $CSI"
assert_true "T70: code-simplifier cites design-review deletion test"        "grep -q 'deletion test' $CSI"

# code-reviewer — change sizing + perfect-is-enemy + splitting strategies + description anti-patterns
CR=".claude/agents/code-reviewer.md"
assert_true "T70: code-reviewer has Step 5.5 change-sizing audit"           "grep -q '5.5 Apply change-sizing audit' $CR"
assert_true "T70: code-reviewer names 100/300/1000 LOC thresholds"          "grep -q '~100 LOC' $CR && grep -q '~300 LOC' $CR && grep -q '~1000 LOC' $CR"
assert_true "T70: code-reviewer lists 4 splitting strategies"               "grep -q 'Stack' $CR && grep -q 'By file group' $CR && grep -q 'Horizontal' $CR && grep -q 'Vertical' $CR"
assert_true "T70: code-reviewer has Step 5.6 change-description audit"      "grep -q '5.6 Apply change-description audit' $CR"
assert_true "T70: code-reviewer names description anti-patterns"            "grep -qE 'Phase 1|Add convenience functions|First line is non-imperative' $CR"
assert_true "T70: code-reviewer has approval guardrail (anti over-blocking)" "grep -qE 'Approval guardrail.*anti over-blocking|definitely improves overall code health' $CR"

# bug-investigation — STOP-the-Line + non-reproducible taxonomy + layer tree + git bisect run
BI=".claude/skills/bug-investigation/SKILL.md"
assert_true "T70: bug-investigation has Stop-the-Line Rule"                 "grep -q '## Stop-the-Line Rule' $BI"
assert_true "T70: Stop-the-Line lists STOP/PRESERVE/DIAGNOSE/FIX/GUARD/RESUME" \
  "grep -q 'STOP' $BI && grep -q 'PRESERVE' $BI && grep -q 'DIAGNOSE' $BI && grep -q 'GUARD' $BI && grep -q 'RESUME' $BI"
assert_true "T70: non-reproducible taxonomy (timing/env/state/random)"      "grep -q 'Timing-dependent' $BI && grep -q 'Environment-dependent' $BI && grep -q 'State-dependent' $BI && grep -qE 'Truly random' $BI"
assert_true "T70: bug-investigation has 'Localize the layer' decision tree" "grep -q 'Localize the layer' $BI"
assert_true "T70: bug-investigation references 'git bisect run'"            "grep -q 'git bisect run' $BI"

# security-reviewer — Three-Tier Boundary System
SR=".claude/agents/security-reviewer.md"
assert_true "T70: security-reviewer Step 2.7 Three-Tier Boundary System"    "grep -q '2.7 Apply Three-Tier Boundary System' $SR"
assert_true "T70: security-reviewer has 'Always Do' tier"                   "grep -q '\\*\\*Always Do' $SR"
assert_true "T70: security-reviewer has 'Ask First' tier mapped to P3.3"    "grep -qE 'Ask First.*P3.3|P3.3 high-risk' $SR"
assert_true "T70: security-reviewer has 'Never Do' tier"                    "grep -q '\\*\\*Never Do' $SR"
assert_true "T70: Three-Tier names auth flow change as 'Ask First'"         "grep -q 'Adding new authentication flows' $SR"

# js-performance-patterns — When-NOT + 5-step workflow + symptom decision tree
JSP=".claude/skills/js-performance-patterns/SKILL.md"
assert_true "T70: js-performance-patterns adds 'When NOT to use' section"   "grep -q '^## When NOT to use' $JSP"
assert_true "T70: js-performance-patterns has '5-step optimization workflow'" \
  "grep -q '5-step optimization workflow' $JSP"
assert_true "T70: js-performance-patterns names MEASURE→IDENTIFY→FIX→VERIFY→GUARD" \
  "grep -q 'MEASURE' $JSP && grep -q 'IDENTIFY' $JSP && grep -q '^4. VERIFY' $JSP && grep -q '^5. GUARD' $JSP"
assert_true "T70: js-performance-patterns has 'Where to start measuring' decision tree" \
  "grep -q 'Where to start measuring' $JSP"

# plan-mode — assumptions framing + dependency graph + risk-first/contract-first slicing
PM=".claude/skills/plan-mode/SKILL.md"
assert_true "T70: plan-mode 'Assumptions — surface immediately' framing"    "grep -q 'Assumptions — surface immediately' $PM"
assert_true "T70: plan-mode includes 'Correct me now' anti-silent-assumption" "grep -q 'Correct me now' $PM"
assert_true "T70: plan-mode has 'Identify the dependency graph' step"       "grep -q 'Identify the dependency graph' $PM"
assert_true "T70: plan-mode names risk-first slicing"                       "grep -qE 'Risk-first|risk-first' $PM"
assert_true "T70: plan-mode names contract-first slicing"                   "grep -qE 'Contract-first|contract-first' $PM"
assert_true "T70: plan-mode requires stating slicing choice in plan"        "grep -qE 'State the choice|Slicing:' $PM"

# Reviewer-side enforcement of new plan-mode requirements
AR=".claude/agents/architect-reviewer.md"
assert_true "T70: architect-reviewer audits dependency-graph identification" \
  "grep -q 'Dependency graph identified' $AR"
assert_true "T70: architect-reviewer audits slicing-strategy statement" \
  "grep -q 'Slicing strategy stated explicitly' $AR"
assert_true "T70: architect-reviewer flags slicing/risk-profile mismatch as HIGH" \
  "grep -qE 'choice doesn.t match the risk profile|HIGH if the choice doesn' $AR"
assert_true "T70: architect-reviewer audits 'ASSUMPTIONS I\\'M MAKING' labeled block" \
  "grep -q 'Assumptions surfaced as labeled block' $AR"
assert_true "T70: architect-reviewer audits 'slice:' field per step (~100 LOC)" \
  "grep -qE 'slice:.*field|>~100 LOC without explicit justification' $AR"

echo
echo "=== T71: ADR-009 + nestjs-clean-architecture skill + reviewer dependency-rule audit ==="

# ADR-009 file structure
ADR9="docs/decisions/ADR-009-clean-architecture-layering-for-modules.md"
assert_true "T71: ADR-009 file exists"                                "test -f $ADR9"
assert_true "T71: ADR-009 status is Accepted"                         "grep -qE '\\*\\*Status:\\*\\*[[:space:]]+Accepted' $ADR9"
assert_true "T71: ADR-009 has all required sections"                  "grep -q '^## Context' $ADR9 && grep -q '^## Decision' $ADR9 && grep -q '^## Alternatives considered' $ADR9 && grep -q '^## Consequences' $ADR9 && grep -q '^## References' $ADR9"
assert_true "T71: ADR-009 names the 4-layer structure"                "grep -qE 'Presentation' $ADR9 && grep -qE 'Application' $ADR9 && grep -qE 'Domain' $ADR9 && grep -qE 'Infrastructure' $ADR9"
assert_true "T71: ADR-009 cites RBAC as canonical"                    "grep -q 'admin/rbac' $ADR9"
assert_true "T71: ADR-009 names the 'no business invariants' exemption" "grep -q 'no business invariants' $ADR9"
assert_true "T71: ADR-009 specifies HIGH/MED/LOW reviewer calibration" "grep -qE 'HIGH.*MED.*LOW|HIGH\\*\\* finding|MED\\*\\*' $ADR9"

# README index includes ADR-009
assert_true "T71: docs/decisions/README.md indexes ADR-009"           "grep -q 'ADR-009' docs/decisions/README.md"

# ADR-001 cross-references ADR-009
assert_true "T71: ADR-001 cross-references ADR-009"                   "grep -q 'ADR-009' docs/decisions/ADR-001-typeorm-first-persistence.md"

# nestjs-clean-architecture skill
NCA=".claude/skills/nestjs-clean-architecture/SKILL.md"
assert_true "T71: nestjs-clean-architecture skill exists"             "test -f $NCA"
assert_true "T71: skill has YAML frontmatter"                         "head -1 $NCA | grep -q '^---$'"
assert_true "T71: skill description starts with 'Use when'"           "grep -m1 '^description:' $NCA | grep -q 'Use when'"
assert_true "T71: skill description has 'NOT for' clause"             "grep -m1 '^description:' $NCA | grep -q 'NOT for'"
assert_true "T71: skill names ADR-009 as authority"                   "grep -q 'ADR-009' $NCA"
assert_true "T71: skill documents 4-layer structure"                  "grep -q '## The 4-layer structure' $NCA"
assert_true "T71: skill has dependency-rule table"                    "grep -q '## The dependency rule' $NCA"
assert_true "T71: skill defines repository-port pattern"              "grep -qE 'Repository port|Pattern 3.*Repository port' $NCA"
assert_true "T71: skill defines TypeORM-adapter pattern with mapper"  "grep -qE 'Repository adapter|toDomain|toPersistence' $NCA"
assert_true "T71: skill defines application-service pattern"          "grep -qE 'Application service|Pattern 5' $NCA"
assert_true "T71: skill cites ADR-001/003/005"                        "grep -q 'ADR-001' $NCA && grep -q 'ADR-003' $NCA && grep -q 'ADR-005' $NCA"
assert_true "T71: skill documents Symbol-token DI wiring"             "grep -qE 'Symbol\\(.*REPOSITORY|provide:.*useClass:' $NCA"
assert_true "T71: skill has anti-patterns section"                    "grep -q '## Anti-patterns' $NCA"
assert_true "T71: skill names @nestjs/cqrs as out-of-scope"           "grep -q '@nestjs/cqrs' $NCA"

# repo-conventions wiring
RC=".claude/skills/repo-conventions/SKILL.md"
assert_true "T71: repo-conventions ADR table includes ADR-009"        "grep -q 'ADR-009' $RC"
assert_true "T71: repo-conventions § 2 cites nestjs-clean-architecture" \
  "grep -q 'nestjs-clean-architecture' $RC"

# CLAUDE.md wiring
assert_true "T71: CLAUDE.md Skill Pointers row for nestjs-clean-architecture" \
  "grep -q 'nestjs-clean-architecture' CLAUDE.md"
assert_true "T71: CLAUDE.md Workflow chains has 'New domain module' row" \
  "grep -qE '\\*\\*New domain module\\*\\*' CLAUDE.md"

# architect-reviewer wiring
AR=".claude/agents/architect-reviewer.md"
assert_true "T71: architect-reviewer Required Reading lists nestjs-clean-architecture" \
  "grep -q 'nestjs-clean-architecture' $AR"
assert_true "T71: architect-reviewer references ADR-009 in compliance audit" \
  "grep -q 'ADR-009' $AR"
assert_true "T71: architect-reviewer audits 4-layer structure planned"    "grep -q '4-layer structure planned' $AR"
assert_true "T71: architect-reviewer audits dependency rule"              "grep -qE 'Dependency rule|dependency-rule violation' $AR"
assert_true "T71: architect-reviewer audits repository ports defined"     "grep -q 'Repository ports defined' $AR"
assert_true "T71: architect-reviewer flags simple-CRUD exemption check"   "grep -q 'Simple-CRUD exemption' $AR"

# code-reviewer wiring
CR=".claude/agents/code-reviewer.md"
assert_true "T71: code-reviewer Required Reading lists nestjs-clean-architecture" \
  "grep -q 'nestjs-clean-architecture' $CR"
assert_true "T71: code-reviewer has Dependency-rule audit section"   "grep -q 'Dependency-rule audit' $CR"
assert_true "T71: code-reviewer flags @nestjs/typeorm import in domain as HIGH" \
  "grep -qE \"@nestjs/typeorm.*HIGH|HIGH.*domain depends on infrastructure\" $CR"
assert_true "T71: code-reviewer flags @Injectable in domain as HIGH"  "grep -qE '@Injectable.*HIGH|HIGH.*runtime-couples' $CR"
assert_true "T71: code-reviewer flags concrete-repo injection bypass as HIGH" \
  "grep -qE 'bypasses the port|injecting a concrete TypeORM' $CR"
assert_true "T71: code-reviewer flags missing repo port on invariant-bearing module as MED" \
  "grep -qE 'no .domain/repositories/.*port file|port-less module' $CR"

# qa-validator alignment with ADR-009 (per-layer test shapes)
QV=".claude/agents/qa-validator.md"
assert_true "T71: qa-validator Required Reading lists nestjs-clean-architecture" \
  "grep -q 'nestjs-clean-architecture' $QV"
assert_true "T71: qa-validator has 'Per-layer test-shape calibration' section" \
  "grep -q 'Per-layer test-shape calibration' $QV"
assert_true "T71: qa-validator names domain entity test as 'Pure unit test'"  "grep -qE 'Pure unit test' $QV"
assert_true "T71: qa-validator names application service test as 'Port-mocked'" \
  "grep -qE 'Port-mocked unit test' $QV"
assert_true "T71: qa-validator names adapter test as 'Integration test'"      "grep -qE 'Integration test' $QV"
assert_true "T71: qa-validator flags service test importing concrete adapter as HIGH" \
  "grep -qE 'imports .*typeorm-repository.*directly|HIGH if the test file imports' $QV"

# nestjs-best-practices prelude cross-link
NBP=".claude/skills/nestjs-best-practices/SKILL.md"
assert_true "T71: nestjs-best-practices prelude has Repo-specific cross-references" \
  "grep -q 'Repo-specific cross-references' $NBP"
assert_true "T71: prelude maps arch-feature-modules to ADR-009"               "grep -qE 'arch-feature-modules.*ADR-009|ADR-009.*arch-feature-modules' $NBP"
assert_true "T71: prelude maps arch-use-repository-pattern to ADR-009"        "grep -qE 'arch-use-repository-pattern.*ADR-009|ADR-009.*arch-use-repository' $NBP"
assert_true "T71: prelude states binding form wins on conflict"               "grep -qE 'binding form wins' $NBP"

echo
echo "=== T72: CLAUDE.md P2 + P3.5 delegation cleanup (no info loss) ==="

# P2 trimmed but load-bearing claims still present
assert_true "T72: P2 retains header"                               "grep -qE '^## P2 — REPO-CORE CONVENTIONS' CLAUDE.md"
assert_true "T72: P2 cites repo-conventions skill"                 "awk '/^## P2/,/^---/' CLAUDE.md | grep -q 'repo-conventions'"
# Note: post-T74 layered-router principle, P2 does NOT enumerate ADRs or HTTP codes — those live in repo-conventions.
# See T74 for the inverse assertion (CLAUDE.md MUST NOT cite ADR-NNN, paths, or code symbols).
assert_true "T72: ADR-backed conventions table in repo-conventions still indexes the 6 convention ADRs (canonical source)" \
  "grep -q 'ADR-001' .claude/skills/repo-conventions/SKILL.md && grep -q 'ADR-002' .claude/skills/repo-conventions/SKILL.md && grep -q 'ADR-003' .claude/skills/repo-conventions/SKILL.md && grep -q 'ADR-004' .claude/skills/repo-conventions/SKILL.md && grep -q 'ADR-005' .claude/skills/repo-conventions/SKILL.md && grep -q 'ADR-009' .claude/skills/repo-conventions/SKILL.md"
assert_true "T72: RBAC scope=all 400 contract lives in repo-conventions § 3" \
  "grep -qE '400' .claude/skills/repo-conventions/SKILL.md"
assert_true "T72: org-scoping IDOR rule lives in repo-conventions" \
  "grep -qiE 'organization_id|IDOR' .claude/skills/repo-conventions/SKILL.md"

# P2 actually got shorter (sanity check)
P2_BLOCK_LINES=$(awk '/^## P2 /{flag=1;next} /^## P3 /{flag=0} flag' CLAUDE.md | wc -l)
if [ "$P2_BLOCK_LINES" -le 20 ]; then
  echo "PASS: T72 P2 block trimmed to ≤20 lines (current: $P2_BLOCK_LINES)"; PASS=$((PASS+1))
else
  echo "FAIL: T72 P2 block too long ($P2_BLOCK_LINES lines, expected ≤20)"
  FAIL=$((FAIL+1)); FAILED_TESTS="$FAILED_TESTS T72-P2-size"
fi

# P3.5 trimmed but load-bearing claims still present
assert_true "T72: P3.5 keeps 'follow the skill' default"           "awk '/^### P3.5/,/^## P4/' CLAUDE.md | grep -q 'follow the skill recommendation'"
assert_true "T72: P3.5 keeps structural-refactor exception"        "awk '/^### P3.5/,/^## P4/' CLAUDE.md | grep -qE 'structural refactor'"
assert_true "T72: P3.5 keeps 'The test' heuristic"                 "awk '/^### P3.5/,/^## P4/' CLAUDE.md | grep -q 'The test:'"
assert_true "T72: P3.5 cross-references decision-rules § 6"        "awk '/^### P3.5/,/^## P4/' CLAUDE.md | grep -qE 'decision-rules.*6|6.*decision-rules'"
assert_true "T72: P3.5 names 'docs bug' contradiction handling"    "awk '/^### P3.5/,/^## P4/' CLAUDE.md | grep -q 'docs bug'"

# P3.5 actually got shorter
P35_BLOCK_LINES=$(awk '/^### P3.5/{flag=1;next} /^## P4/{flag=0} flag' CLAUDE.md | wc -l)
if [ "$P35_BLOCK_LINES" -le 16 ]; then
  echo "PASS: T72 P3.5 block trimmed to ≤16 lines (current: $P35_BLOCK_LINES)"; PASS=$((PASS+1))
else
  echo "FAIL: T72 P3.5 block too long ($P35_BLOCK_LINES lines, expected ≤16)"
  FAIL=$((FAIL+1)); FAILED_TESTS="$FAILED_TESTS T72-P3.5-size"
fi

# Moved content lives in decision-rules § 6 (no info loss)
DR=".claude/skills/decision-rules/SKILL.md"
assert_true "T72: decision-rules § 6 has 'What is NOT structural' examples" \
  "grep -q 'What is NOT structural' $DR"
assert_true "T72: § 6 'NOT structural' includes NotFoundException example" \
  "awk '/^### 6\\./,/^### 7\\./' $DR | grep -q 'NotFoundException'"
assert_true "T72: § 6 'NOT structural' includes db.transaction example" \
  "awk '/^### 6\\./,/^### 7\\./' $DR | grep -q 'db.transaction'"
assert_true "T72: § 6 'NOT structural' includes Guard/Pipe/Interceptor example" \
  "awk '/^### 6\\./,/^### 7\\./' $DR | grep -qE 'Guard.*Pipe.*Interceptor'"
assert_true "T72: § 6 'NOT structural' includes 4-layer module example (ADR-009)" \
  "awk '/^### 6\\./,/^### 7\\./' $DR | grep -qE 'ADR-009.*4-layer|4-layer.*ADR-009'"

# Moved content (RBAC scope contract, error/logger conventions) still in repo-conventions
RC=".claude/skills/repo-conventions/SKILL.md"
assert_true "T72: repo-conventions § 3 still has RBAC scope contract" "grep -q '## 3. RBAC scope contract' $RC"
assert_true "T72: repo-conventions § 6 still has Error handling"      "grep -q '## 6. Error handling' $RC"
assert_true "T72: repo-conventions § 7 still has Logger"              "grep -q '## 7. Logger' $RC"

# Word budget ratchets back down
assert_true "T72: T13 budget ratcheted back to 3350 (post-trim)"      "grep -q '<= 3350 words' .claude/tests/run-acceptance.sh"

echo
echo "=== T73: CLAUDE.md prose-tightening (A+B+C+D) preserves load-bearing claims ==="

# A — P3.4 mandatory matrix retains all 7 skills + the override-the-heuristic rule
P34_BLOCK=$(awk '/^### P3.4/,/^### P3.5/' CLAUDE.md)
assert_true "T73-A: P3.4 retains 'override description-trigger' framing" \
  "echo \"\$P34_BLOCK\" | grep -qE 'override description-trigger|override the description-trigger|override description'"
assert_true "T73-A: P3.4 retains tdd-workflow row"            "echo \"\$P34_BLOCK\" | grep -q '\\\`tdd-workflow\\\`'"
assert_true "T73-A: P3.4 retains failure-mode-analysis row"   "echo \"\$P34_BLOCK\" | grep -q '\\\`failure-mode-analysis\\\`'"
assert_true "T73-A: P3.4 retains repo-conventions row"        "echo \"\$P34_BLOCK\" | grep -q '\\\`repo-conventions\\\`'"
assert_true "T73-A: P3.4 retains design-review row"           "echo \"\$P34_BLOCK\" | grep -q '\\\`design-review\\\`'"
assert_true "T73-A: P3.4 retains plan-mode row"               "echo \"\$P34_BLOCK\" | grep -q '\\\`plan-mode\\\`'"
assert_true "T73-A: P3.4 retains async-error-handling row"    "echo \"\$P34_BLOCK\" | grep -q '\\\`async-error-handling\\\`'"
assert_true "T73-A: P3.4 retains database-transactions row"   "echo \"\$P34_BLOCK\" | grep -q '\\\`database-transactions\\\`'"
assert_true "T73-A: P3.4 table is 2-column (When MUST fire only, no 'What goes wrong')" \
  "echo \"\$P34_BLOCK\" | grep -qE '^\\| Skill \\| When MUST fire \\|\$' && ! echo \"\$P34_BLOCK\" | grep -qE 'What goes wrong if it doesn'"

# B — P5 retains all load-bearing always-on disciplines
P5_BLOCK=$(awk '/^## P5/,/^## P6/' CLAUDE.md)
assert_true "T73-B: P5 retains memory-consultation rule"      "echo \"\$P5_BLOCK\" | grep -q 'Consult feedback memories first'"
assert_true "T73-B: P5 retains scope discipline"              "echo \"\$P5_BLOCK\" | grep -q 'Scope discipline'"
assert_true "T73-B: P5 retains surgical diffs"                "echo \"\$P5_BLOCK\" | grep -q 'Surgical diffs'"
assert_true "T73-B: P5 retains root-cause focus + no retries (merged)" \
  "echo \"\$P5_BLOCK\" | grep -qE 'Root-cause focus.*MUST fail fast|fail fast with actionable'"
assert_true "T73-B: P5 retains stop-on-confusion + proceed-when-clear (merged)" \
  "echo \"\$P5_BLOCK\" | grep -q 'Stop on confusion / Proceed when clear'"
assert_true "T73-B: P5 cross-references pushback-templates" \
  "echo \"\$P5_BLOCK\" | grep -q 'pushback-templates'"
assert_true "T73-B: P5 cross-references plan-mode for re-plan trigger" \
  "echo \"\$P5_BLOCK\" | grep -qE 'plan-mode.*Re-plan|re-plan'"
# Old standalone bullets removed
assert_true "T73-B: P5 no longer has standalone 'No retries' bullet" \
  "! echo \"\$P5_BLOCK\" | grep -qE '^- \\*\\*No retries\\.'"
assert_true "T73-B: P5 no longer has standalone 'Pushback duty' bullet" \
  "! echo \"\$P5_BLOCK\" | grep -qE '^- \\*\\*Pushback duty\\.'"
assert_true "T73-B: P5 no longer has standalone 'Plan mode by default' bullet" \
  "! echo \"\$P5_BLOCK\" | grep -qE '^- \\*\\*Plan mode by default\\*\\*'"
assert_true "T73-B: P5 no longer has standalone 'Re-plan when reality changes' bullet" \
  "! echo \"\$P5_BLOCK\" | grep -qE '^- \\*\\*Re-plan when reality changes\\*\\*'"

# C — P0.3 retains the 4-step protocol structure
P03_BLOCK=$(awk '/^### P0.3/,/^---/' CLAUDE.md)
assert_true "T73-C: P0.3 retains step 1 (output exact command)"   "echo \"\$P03_BLOCK\" | grep -qE 'output the exact command'"
assert_true "T73-C: P0.3 retains step 2 (impact summary)"          "echo \"\$P03_BLOCK\" | grep -qE 'impact summary'"
assert_true "T73-C: P0.3 retains git-workflow + db-write-protocol cites" \
  "echo \"\$P03_BLOCK\" | grep -q 'git-workflow' && echo \"\$P03_BLOCK\" | grep -q 'db-write-protocol'"
assert_true "T73-C: P0.3 retains step 3 (Awaiting approval line)"  "echo \"\$P03_BLOCK\" | grep -q 'Awaiting approval'"
assert_true "T73-C: P0.3 retains 'MUST stop' rule"                 "echo \"\$P03_BLOCK\" | grep -qE 'MUST stop|MUST NOT execute until'"

# D — P8 item 11 is one-line
assert_true "T73-D: P8 item 11 retains 'Skills consulted:' label" "grep -qE '^11\\.' CLAUDE.md && grep -qE '^11\\..*Skills consulted' CLAUDE.md"
assert_true "T73-D: P8 item 11 retains alphabetical-list rule"    "grep -qE '^11\\..*alphabetical' CLAUDE.md"
assert_true "T73-D: P8 item 11 retains self-attestation rule"     "grep -qiE '^11\\..*(self-attestation|do NOT list skills you only saw)' CLAUDE.md"

# Word budget ratchets back down
assert_true "T73: T13 budget ratcheted back to 3350 (post-A+B+C+D)" "grep -q '<= 3350 words' .claude/tests/run-acceptance.sh"

echo
echo "=== T74: Layered-router principle (CLAUDE.md is pure routing) ==="

# CLAUDE.md does NOT cite specific ADR numbers
assert_true "T74: CLAUDE.md does NOT enumerate ADR-NNN" \
  "! grep -qE 'ADR-[0-9]{3}' CLAUDE.md"

# CLAUDE.md does NOT contain docs/decisions/ paths
assert_true "T74: CLAUDE.md does NOT contain docs/decisions/ paths" \
  "! grep -q 'docs/decisions/' CLAUDE.md"

# CLAUDE.md does NOT contain src/<dir>/ source paths (skip the example placeholder src/foo.ts)
assert_true "T74: CLAUDE.md does NOT contain real src/<module>/ paths" \
  "! grep -qE 'src/(modules|shared|admin|chat|projects|airweave|database)/' CLAUDE.md"

# CLAUDE.md does NOT cite typical code symbols (decorators / class names that should live in skills)
assert_true "T74: CLAUDE.md does NOT cite @RequirePermissions decorator" \
  "! grep -q '@RequirePermissions' CLAUDE.md"
assert_true "T74: CLAUDE.md does NOT cite PermissionsGuard class"        "! grep -q 'PermissionsGuard' CLAUDE.md"
assert_true "T74: CLAUDE.md does NOT cite resolveOrgScope function"      "! grep -q 'resolveOrgScope' CLAUDE.md"
assert_true "T74: CLAUDE.md does NOT cite @InjectRepository decorator"   "! grep -q '@InjectRepository' CLAUDE.md"
assert_true "T74: CLAUDE.md does NOT cite NestJS exception class names"  "! grep -qE 'NotFoundException|ForbiddenException|BadRequestException|HttpException' CLAUDE.md"

# documentation-and-adrs codifies the principle
DA=".claude/skills/documentation-and-adrs/SKILL.md"
assert_true "T74: documentation-and-adrs has 'Layered-router principle' section" \
  "grep -q 'Layered-router principle' $DA"
assert_true "T74: principle states 'CLAUDE.md is the always-loaded router'" \
  "grep -qiE 'CLAUDE.md is the always-loaded router|CLAUDE.md is.*pure routing|CLAUDE.md is NEVER updated' $DA"
assert_true "T74: principle enumerates allowed CLAUDE.md references"     "grep -q 'CLAUDE.md MAY reference' $DA"
assert_true "T74: principle enumerates forbidden CLAUDE.md references"   "grep -q 'CLAUDE.md MUST NOT reference' $DA"
assert_true "T74: principle names the single-source-of-truth flow"       "grep -q 'single-source-of-truth flow' $DA"
assert_true "T74: principle names enforcement (T74 + meta-skill-hygiene + reviewers)" \
  "grep -qE 'T74.*meta-skill-hygiene|T74' $DA && grep -q 'meta-skill-hygiene' $DA"

# meta-skill-hygiene has audit check 7
MSH=".claude/skills/meta-skill-hygiene/SKILL.md"
assert_true "T74: meta-skill-hygiene has '7. CLAUDE.md cross-coupling' check" \
  "grep -q '7. CLAUDE.md cross-coupling' $MSH"
assert_true "T74: audit names ADR-NNN regex check"                       "grep -qE 'ADR-\\[0-9\\]\\{3\\}' $MSH"
assert_true "T74: audit names file-path scan"                            "grep -q 'file paths' $MSH"
assert_true "T74: audit names code-symbol scan"                          "grep -q 'code symbols' $MSH"

# code-reviewer flags CLAUDE.md artifact citations
CR=".claude/agents/code-reviewer.md"
assert_true "T74: code-reviewer has 'CLAUDE.md layered-router audit'" \
  "grep -q 'CLAUDE.md layered-router audit' $CR"
assert_true "T74: code-reviewer flags CLAUDE.md ADR-NNN citation as MED" \
  "grep -qE 'ADR-\\[0-9\\]\\{3\\}.*MED|Each occurrence = \\*\\*MED' $CR"

# architect-reviewer flags plan steps that would add artifact citations to CLAUDE.md
AR=".claude/agents/architect-reviewer.md"
assert_true "T74: architect-reviewer has 'CLAUDE.md layered-router audit'" \
  "grep -q 'CLAUDE.md layered-router audit' $AR"

# repo-conventions description broadened to cover non-code architecture discussions
RC=".claude/skills/repo-conventions/SKILL.md"
assert_true "T74: repo-conventions description covers architecture discussions" \
  "grep -m1 '^description:' $RC | grep -qiE 'architecture|even on non-code turns'"
assert_true "T74: repo-conventions description acknowledges CLAUDE.md no longer enumerates ADRs" \
  "grep -m1 '^description:' $RC | grep -qE 'CLAUDE.md no longer enumerates|primes the model'"

# T13 budget ratcheted to 3350 (post-T74)
assert_true "T74: T13 budget ratcheted to 3350"                         "grep -q '<= 3350 words' .claude/tests/run-acceptance.sh"

echo
echo "=== T75: cross-repo-workspace skill (workspace topology with spa-velocity) ==="

XRS=".claude/skills/cross-repo-workspace/SKILL.md"

# Structural — file present and frontmatter well-formed
assert_true "T75: cross-repo-workspace SKILL.md exists" "test -f $XRS"
XRS_DESC=$(awk '/^description:/{sub(/^description:[[:space:]]*/,""); print; exit}' "$XRS" 2>/dev/null || echo "")
assert_true "T75: description starts with 'Use ALWAYS when'"  "echo \"\$XRS_DESC\" | grep -q '^Use ALWAYS when'"
assert_true "T75: description has 'NOT for' exclusion"        "echo \"\$XRS_DESC\" | grep -q 'NOT for'"
assert_true "T75: description names both repos by name"       "echo \"\$XRS_DESC\" | grep -qE 'api-velocity.*spa-velocity|spa-velocity.*api-velocity'"

# Rules 1-7 all present
assert_true "T75: Rule 1 (Active-lens by path)"      "grep -q 'Rule 1 — Active-lens by path' $XRS"
assert_true "T75: Rule 2 (ADR-qualification)"        "grep -q 'Rule 2 — ADR-qualification' $XRS"
assert_true "T75: Rule 3 (Coordinated cross-repo)"   "grep -q 'Rule 3 — Coordinated' $XRS"
assert_true "T75: Rule 4 (ADR adoption that binds)"  "grep -q 'Rule 4 — ADR adoption' $XRS"
assert_true "T75: Rule 5 (Memory-keying)"            "grep -q 'Rule 5 — Memory' $XRS"
assert_true "T75: Rule 6 (Prompt-target convention)" "grep -q 'Rule 6 — Prompt' $XRS"
assert_true "T75: Rule 7 (Settings-gate scope)"      "grep -q 'Rule 7 — Settings' $XRS"

# Critical content — ADR-collision table and lens-switch attestation
assert_true "T75: ADR collision table names TypeORM (api side)"       "grep -q 'TypeORM-first persistence' $XRS"
assert_true "T75: ADR collision table names Zustand (spa side)"       "grep -q 'Zustand for client state' $XRS"
assert_true "T75: lens-switch attestation directive ('Lens-switch:')" "grep -q 'Lens-switch:' $XRS"

# Router wiring — P3.4 force-load + Skill Pointers (loose check; both should mention it)
assert_true "T75: P3.4 lists cross-repo-workspace as force-load" \
  "awk '/^### P3.4/,/^### P3.5/' .ruler/instructions.md | grep -q 'cross-repo-workspace'"
assert_true "T75: Skill Pointers row for cross-repo-workspace exists" \
  "awk '/^## Skill Pointers/{flag=1; next} /^## Workflow/{exit} flag' .ruler/instructions.md | grep -q 'cross-repo-workspace'"

# Cross-repo qualifier rule — skill body uses qualified ADR refs.
# Real format uses bold: '**api-velocity** ADR-XXX'. Accept both bold and plain qualifiers.
assert_true "T75: skill body uses qualified ADR refs (**api-velocity** ADR-XXX or **spa-velocity** ADR-XXX)" \
  "grep -qE '\\*\\*api-velocity\\*\\* ADR-|\\*\\*spa-velocity\\*\\* ADR-|api-velocity ADR-|spa-velocity ADR-' $XRS"

# Enforcement directives — these turn doctrine into subagent audit items.
# Without them, the cross-repo rules are advisory; with them, code-reviewer +
# architect-reviewer have explicit MED/HIGH findings to surface.
assert_true "T75: ENFORCE-1 per-repo architect-reviewer invocation directive"  "grep -q 'ENFORCE-1' $XRS"
assert_true "T75: ENFORCE-2 coordination-doc presence audit directive"         "grep -q 'ENFORCE-2' $XRS"
assert_true "T75: ENFORCE-3 lens-switch attestation audit directive"           "grep -q 'ENFORCE-3' $XRS"
assert_true "T75: ENFORCE-4 bare ADR-NNN audit directive"                      "grep -q 'ENFORCE-4' $XRS"
assert_true "T75: ENFORCE-1 names architect-reviewer as the executor"          "awk '/ENFORCE-1/,/ENFORCE-2/' $XRS | grep -q 'architect-reviewer'"
assert_true "T75: ENFORCE-2 names architect-reviewer as the executor"          "awk '/ENFORCE-2/,/ENFORCE-3/' $XRS | grep -q 'architect-reviewer'"
assert_true "T75: ENFORCE-3 names code-reviewer as the executor"               "awk '/ENFORCE-3/,/ENFORCE-4/' $XRS | grep -q 'code-reviewer'"
assert_true "T75: ENFORCE-1 cites severity (MED)"                              "awk '/ENFORCE-1/,/ENFORCE-2/' $XRS | grep -q 'MED'"
assert_true "T75: ENFORCE-2 cites severity (HIGH)"                             "awk '/ENFORCE-2/,/ENFORCE-3/' $XRS | grep -q 'HIGH'"
assert_true "T75: ENFORCE-3 cites severity (HIGH)"                             "awk '/ENFORCE-3/,/ENFORCE-4/' $XRS | grep -q 'HIGH'"
assert_true "T75: ENFORCE-4 cites severity (MED)"                              "awk '/ENFORCE-4/,/^## /' $XRS | grep -q 'MED'"

echo
echo "==========================="
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "Failed:$FAILED_TESTS"
  exit 1
fi
exit 0
