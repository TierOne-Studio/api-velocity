#!/usr/bin/env bash
#
# spec-links-check.sh — validates spec cross-links (SPEC-000 / test #4, #11).
#
# - counterpart_spec must be empty, "standalone", or "<repo>#SPEC-NNN".
#   If COUNTERPART_REPO_ROOT is set, the target file must exist there; else a note is emitted.
# - related_specs SPEC-NNN tokens must resolve to a spec in this repo (SPECS_DIR).
#
# Usage: spec-links-check.sh [file...]   (default: docs/specs/SPEC-*.md docs/specs/PRD-*.md)
set -uo pipefail

files=("$@")
if [[ ${#files[@]} -eq 0 ]]; then
  shopt -s nullglob
  files=(docs/specs/SPEC-*.md docs/specs/PRD-*.md)
fi
SPECS_DIR="${SPECS_DIR:-docs/specs}"
fail=0

fm_val() { # <file> <key>
  awk 'NR==1&&/^---/{f=1;next} f&&/^---/{exit} f' "$1" \
    | grep -E "^$2:" | sed -E "s/^$2:[[:space:]]*//; s/^\"//; s/\"$//"
}

for f in "${files[@]}"; do
  [[ "$(basename "$f")" == "_template.md" ]] && continue
  [[ -f "$f" ]] || continue
  errs=()

  cp_spec="$(fm_val "$f" counterpart_spec)"
  if [[ -n "$cp_spec" && "$cp_spec" != "standalone" && "$cp_spec" != "[]" ]]; then
    if [[ ! "$cp_spec" =~ ^[a-z0-9-]+#SPEC-[0-9]{3}$ ]]; then
      errs+=("counterpart_spec malformed: '$cp_spec' (want <repo>#SPEC-NNN | standalone | empty)")
    elif [[ -n "${COUNTERPART_REPO_ROOT:-}" ]]; then
      num="${cp_spec#*#SPEC-}"
      ls "${COUNTERPART_REPO_ROOT}/docs/specs/SPEC-${num}-"*.md >/dev/null 2>&1 \
        || errs+=("counterpart_spec '$cp_spec' not found under $COUNTERPART_REPO_ROOT/docs/specs")
    else
      echo "note: $(basename "$f") counterpart_spec '$cp_spec' — cross-repo resolution skipped (set COUNTERPART_REPO_ROOT to verify)"
    fi
  fi

  rel="$(fm_val "$f" related_specs)"
  for tok in $(printf '%s' "$rel" | grep -oE 'SPEC-[0-9]{3}' || true); do
    ls "${SPECS_DIR}/${tok}-"*.md >/dev/null 2>&1 || errs+=("related_specs '$tok' not found in $SPECS_DIR")
  done

  if [[ ${#errs[@]} -gt 0 ]]; then
    echo "LINK ERRORS: $f"; printf '   - %s\n' "${errs[@]}"; fail=1
  else
    echo "ok: $f"
  fi
done
[[ "$fail" == 0 ]]
