#!/usr/bin/env bash
# simulate-prompts.sh — static skill-trigger simulation.
#
# This is NOT an LLM run. It's a static contract test: for each canonical
# (prompt, expected_skills) case, assert that every expected skill's
# description contains enough keywords from the prompt that the LLM's
# description-match heuristic would plausibly load it.
#
# Failure means trigger drift: either the skill description was weakened,
# or the prompt's expected skill list is now stale. Either way, the
# acceptance test catches it before silent skill-skipping ships.
#
# Threshold: every expected skill must contain ≥1 lowercased prompt token
# (length ≥4) in its description. Stop-words filtered. Threshold=1 catches
# description drift (a removed trigger keyword fails the test) without
# false positives on prompts whose obvious keywords are short (bug, git, db).
#
# Usage: bash .claude/tests/simulate-prompts.sh

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

PASS=0
FAIL=0
FAILED=""

# Stop-words excluded from keyword matching (too generic to be meaningful triggers).
STOP_WORDS="the a an this that these those is are was were be been being have has had do does did will would could should may might can must shall and or but if then else when while of in on at by for to from with into onto over under up down out off about a our we i you they it its their our we my your"

# Returns description (single line) for a given skill name.
skill_description() {
  local name="$1"
  local f=".claude/skills/$name/SKILL.md"
  if [ ! -f "$f" ]; then
    echo ""
    return
  fi
  awk '/^description:/{sub(/^description:[[:space:]]*/,""); print; exit}' "$f" | tr '[:upper:]' '[:lower:]'
}

# Tokenise prompt: lowercase, strip non-alpha, drop stop-words, drop tokens <4 chars.
prompt_tokens() {
  local p="$1"
  echo "$p" | tr '[:upper:]' '[:lower:]' \
    | tr -c '[:alpha:]' ' ' \
    | tr ' ' '\n' \
    | awk -v stop="$STOP_WORDS" '
        BEGIN { n = split(stop, arr, " "); for (i=1;i<=n;i++) s[arr[i]] = 1 }
        length($0) >= 4 && !($0 in s) { print }
      ' \
    | sort -u
}

# Count how many prompt tokens appear in skill description (substring match).
match_count() {
  local prompt="$1" desc="$2"
  local count=0
  while IFS= read -r tok; do
    [ -z "$tok" ] && continue
    if printf '%s' "$desc" | grep -q "$tok"; then
      count=$((count+1))
    fi
  done <<EOF
$(prompt_tokens "$prompt")
EOF
  echo "$count"
}

# Assert: for the given (prompt, expected_skill), description contains ≥THRESHOLD prompt tokens.
THRESHOLD=1
check_case() {
  local case_name="$1" prompt="$2" expected_skill="$3"
  local desc
  desc=$(skill_description "$expected_skill")
  if [ -z "$desc" ]; then
    echo "FAIL: $case_name — skill '$expected_skill' has no description (or skill missing)"
    FAIL=$((FAIL+1)); FAILED="$FAILED $case_name:$expected_skill"
    return
  fi
  local n
  n=$(match_count "$prompt" "$desc")
  if [ "$n" -ge "$THRESHOLD" ]; then
    echo "PASS: $case_name → $expected_skill (matched $n keyword(s))"
    PASS=$((PASS+1))
  else
    echo "FAIL: $case_name → $expected_skill (only $n keyword(s) matched, need ≥$THRESHOLD)"
    echo "  prompt: $prompt"
    echo "  desc[:200]: ${desc:0:200}"
    FAIL=$((FAIL+1)); FAILED="$FAILED $case_name:$expected_skill"
  fi
}

# Assert: the workflow chain table in CLAUDE.md mentions all expected skills for the case.
# Loose check: every expected skill name appears at least once in the "Workflow chains" section.
check_workflow_chain_mentions() {
  local case_name="$1" expected_skills_csv="$2"
  local section
  section=$(awk '/^## Workflow chains/{flag=1} flag; /^## /{if(NR>1 && flag && !/^## Workflow chains/) flag=0}' CLAUDE.md)
  IFS=',' read -ra arr <<< "$expected_skills_csv"
  for s in "${arr[@]}"; do
    if printf '%s' "$section" | grep -q "$s"; then
      echo "PASS: $case_name workflow-chain mentions $s"
      PASS=$((PASS+1))
    else
      echo "FAIL: $case_name workflow-chain missing mention of $s"
      FAIL=$((FAIL+1)); FAILED="$FAILED $case_name:chain:$s"
    fi
  done
}

echo "=== Skill-loading simulation: prompt → expected skill descriptions ==="

# Format: case_id | prompt | expected skills (csv)
# Each prompt is phrased as a typical user request; the expected skills are those
# the model SHOULD load via description match. Failure ⇒ description has drifted
# OR the case is now stale and needs updating.
run_case() {
  local id="$1" prompt="$2" expected_csv="$3"
  IFS=',' read -ra skills <<< "$expected_csv"
  for s in "${skills[@]}"; do
    check_case "$id" "$prompt" "$s"
  done
}

# NOTE: Per CLAUDE.md P3.4, several skills (tdd-workflow, repo-conventions, design-review,
# failure-mode-analysis) are MANDATORY for any executable-code change — they fire regardless
# of description keyword match. Per-case keyword assertions below only cover DISCRETIONARY
# skills (those whose triggering depends on the prompt's content). Workflow-chain coverage
# (later in this file) validates mandatory skills are documented in CLAUDE.md.

# Bug fix flow — discretionary trigger: bug-investigation
run_case "bug-fix-clear" \
  "given the failing test report investigate the broken login incident" \
  "bug-investigation"

# New feature flow — discretionary trigger: plan-mode (multi-file architectural)
run_case "new-feature" \
  "plan a non-trivial multi-file architectural change adding a chat endpoint with database persistence" \
  "plan-mode"

# Async / external integration — discretionary triggers
run_case "async-timeout" \
  "writing async promise composition with abortsignal timeouts and error propagation" \
  "async-error-handling"

# Multi-statement DB write — discretionary triggers
run_case "multi-statement-db" \
  "implementing multi-statement database insert update delete across multiple rows tables atomic" \
  "database-transactions,db-write-protocol"

# Pure DB write protocol
run_case "single-write" \
  "delete inactive sessions from the database" \
  "db-write-protocol"

# Cyclomatic complexity
run_case "branchy-function" \
  "this function has many nested conditional branches and growing if-else chains" \
  "cyclomatic-complexity"

# NestJS provider/cross-cutting design — discretionary trigger: nestjs-patterns
run_case "nestjs-guard" \
  "design a nestjs guard pipe interceptor middleware provider with usefactory dynamic forroot" \
  "nestjs-patterns"

# Git workflow
run_case "git-rebase" \
  "rebase the feature branch onto master and force push" \
  "git-workflow"

# CI failure investigation — discretionary triggers
run_case "ci-failure" \
  "given the failing test investigate the production incident broken on continuous integration" \
  "bug-investigation"

# Performance hot path
run_case "perf-hotpath" \
  "optimize this hot loop performance for large datasets and high frequency events" \
  "js-performance-patterns"

# Large unfamiliar codebase
run_case "large-codebase" \
  "explore this large unfamiliar codebase and dense context with multiple modules" \
  "rlm-explore"

# Skill library audit
run_case "skill-audit" \
  "review the skill library quality and check for misfiring overlapping skills" \
  "meta-skill-hygiene"

# TypeScript advanced types
run_case "ts-generics" \
  "build a reusable generic type utility with conditional and mapped types" \
  "typescript-advanced-types"

# Failure mode analysis pre-test — discretionary trigger
run_case "failure-modes" \
  "before writing the failing test anticipate enumerate failure modes null empty large race partial" \
  "failure-mode-analysis"

# Refactor without behavior change — discretionary trigger: code-simplifier
run_case "refactor-cleanup" \
  "simplify recently modified code clarity consistency maintainability preserve behavior cleanup" \
  "code-simplifier"

# Design review (always before declaring done)
run_case "design-review" \
  "before declaring this code change complete review against SOLID DRY KISS principles" \
  "design-review"

# Plan mode
run_case "plan-architectural" \
  "plan a multi-file architectural change across several modules with verification steps" \
  "plan-mode"

# Decision rules ambiguous request
run_case "ambiguous-request" \
  "the user request is ambiguous and scope is unclear which decision rule applies" \
  "decision-rules"

# Pushback templates
run_case "pushback-simpler" \
  "i need to push back on the user with a simpler in-scope alternative" \
  "pushback-templates"

# Repo conventions — discretionary trigger pairs with tdd-workflow per its description
run_case "repo-conventions-trigger" \
  "implementing reviewing refactoring executable code repository nestjs typeorm rbac scope" \
  "repo-conventions"

# === Workflow-chain coverage assertions ===
# For canonical task types, the CLAUDE.md "Workflow chains" section should
# mention every expected skill so a senior engineer reading the chain table
# sees the same recipe the model would assemble from description match.
echo
echo "=== Workflow-chain coverage (CLAUDE.md mentions every expected skill) ==="
check_workflow_chain_mentions "bug-fix-flow"      "bug-investigation,failure-mode-analysis,tdd-workflow,repo-conventions,design-review"
check_workflow_chain_mentions "new-feature-flow"  "plan-mode,failure-mode-analysis,tdd-workflow,repo-conventions,design-review"
check_workflow_chain_mentions "refactor-flow"     "code-simplifier,cyclomatic-complexity,repo-conventions,design-review"
check_workflow_chain_mentions "perf-flow"         "rlm-explore,js-performance-patterns,failure-mode-analysis,tdd-workflow,design-review"
check_workflow_chain_mentions "async-flow"        "async-error-handling,failure-mode-analysis,tdd-workflow,design-review"
check_workflow_chain_mentions "nestjs-design"     "nestjs-best-practices,nestjs-patterns,repo-conventions,design-review"

echo
echo "==========================="
echo "Simulation results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "Failed:$FAILED"
  exit 1
fi
exit 0
