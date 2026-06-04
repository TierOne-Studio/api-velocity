#!/usr/bin/env bash
#
# spec-complete-check.sh — fails specs that aren't ready (SPEC-000 §18.6 / test #9).
#
# A spec is INCOMPLETE if it has a placeholder token, an empty required frontmatter key,
# or a missing required section. Skips _template.md.
#
# Usage: spec-complete-check.sh [file...]   (default: docs/specs/SPEC-*.md docs/specs/PRD-*.md)
set -uo pipefail

files=("$@")
if [[ ${#files[@]} -eq 0 ]]; then
  shopt -s nullglob
  files=(docs/specs/SPEC-*.md docs/specs/PRD-*.md)
fi

PLACEHOLDERS='TBD|FIXME|\?\?\?|SPEC-NNN|YYYY-MM-DD|<Human Title>|<title>|<name>|<Feature>|<reason>|<assumption>|<bullets>|<what changed>|<placeholder>'
REQ_KEYS=(id title status layer owner created)
REQ_SECTIONS=('## 1.' '## 2.' '## 3.' '## 4.' '## 5.' '## 6.' '## 7.' '## 8.' '## 9.' '## 10.' '## Change Log')

fail=0
for f in "${files[@]}"; do
  [[ "$(basename "$f")" == "_template.md" ]] && continue
  [[ -f "$f" ]] || { echo "MISSING: $f"; fail=1; continue; }
  errs=()

  # Flag placeholder tokens, but ignore any inside inline-code spans (`...`) —
  # those are documentation about placeholders, not unfilled placeholders.
  while IFS= read -r line; do
    num="${line%%:*}"; content="${line#*:}"
    stripped="$(printf '%s' "$content" | sed 's/`[^`]*`//g')"
    printf '%s' "$stripped" | grep -qE "$PLACEHOLDERS" && errs+=("placeholder → $num:$content")
  done < <(grep -nE "$PLACEHOLDERS" "$f" || true)

  fm="$(awk 'NR==1&&/^---/{f=1;next} f&&/^---/{exit} f' "$f")"
  for k in "${REQ_KEYS[@]}"; do
    val="$(printf '%s\n' "$fm" | grep -E "^$k:" | sed -E "s/^$k:[[:space:]]*//")"
    [[ -z "${val//\"/}" ]] && errs+=("frontmatter '$k' empty/missing")
  done

  for s in "${REQ_SECTIONS[@]}"; do
    # Anchor at line start so a prose/inline mention of "## 10." doesn't satisfy the header check.
    grep -qE "^$(printf '%s' "$s" | sed 's/[.]/\\./g')" "$f" || errs+=("missing section: $s")
  done

  if [[ ${#errs[@]} -gt 0 ]]; then
    echo "INCOMPLETE: $f"; printf '   - %s\n' "${errs[@]}"; fail=1
  else
    echo "ok: $f"
  fi
done
[[ "$fail" == 0 ]]
