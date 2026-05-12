---
name: rlm-explore
description: Use when working in a large or unfamiliar codebase, or when the user provides large/dense context (logs, multiple docs, full repos, long error output). NOT for small focused changes where the relevant code is already obvious, factual single-file questions, or trivial bug fixes.
---

# RLM Explore — Recursive Language Model Mechanics

Treat user-supplied material as an external corpus **P = {specs, logs, code, docs}** to be inspected in slices, not loaded whole. The deliverable is a Working Set **W** (5–15 bullets) that drives all subsequent decisions.

## Five operations (in order)

1. **LOCATE** — identify relevant slices: keywords, symbols, filenames, endpoints, error codes.
2. **EXTRACT** — pull the minimum snippets needed for the current step. No bulk dumps.
3. **CHUNK** — split large context into small units (per file, per error, per request).
4. **TRANSFORM** — summarize into Working Set **W** (5–15 bullets).
5. **VERIFY** — cross-check **W** vs requirements and observed behavior.

## Working Set W format

```
Working Set W (5–15 bullets):
- <claim or fact>: <minimal evidence pointer> (file:line, log line, or doc anchor)
- ...
```

Every bullet must cite an evidence pointer. No bullet without a source.

## REPL transcript (mandatory when P is large/dense)

If commands cannot be run here, output the exact commands that *would* be run plus expected findings. Keep it short.

```
REPL:
- rg/grep/find commands (exact, copy-pasteable)
- expected hits (files/symbols/line ranges)
- extracted snippet titles (no large dumps)
```

Use `rg` (ripgrep) over `grep` where available. Prefer symbol search over text search. Avoid `find` recursion across `node_modules` / build artifacts.

## Stop-exploring criteria

Stop when **any** of these is true:
- W has 5–15 bullets that fully cover the requirement.
- Further exploration is duplicating earlier findings.
- A blocking ambiguity has surfaced — stop and ask, don't keep digging.
- Confidence ≥ 0.9 that you have the right slices.

## Sub-passes (rare)

Use 0–2 sub-passes total. Each sub-pass produces ONE focused artifact (e.g., a checklist of all places a config value is read). Avoid recursion.

## Anti-patterns

- Reading whole files when only a function matters.
- Pasting large logs back into the response.
- Running broad searches (`rg foo` across the repo) when a scoped search would do.
- Building W without evidence pointers.
- Using sub-passes to do work the root pass should be doing.
