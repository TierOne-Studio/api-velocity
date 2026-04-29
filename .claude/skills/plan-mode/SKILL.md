---
name: plan-mode
description: Use BEFORE executing non-trivial tasks — 3+ steps, multi-file changes, architectural or design decisions, debugging with uncertain root cause, verification work, anything with meaningful behavior or delivery risk. NOT for trivial single-file edits, factual answers, or read-only investigations where the answer is obvious.
---

# Plan Mode

Plan before code. Reduces ambiguity, surfaces risk, prevents scope drift.

## Step 0 — Requirements confirmation (scope gate)

Output explicitly:
- **Requirements + acceptance criteria** — falsifiable, not "make it work".
- **Non-goals / out of scope** — what we are *not* doing.
- **Assumptions** — only the ones that affect behavior, architecture, or delivery risk.
- **Multiple interpretations** — if more than one reasonable reading exists, list them. Do **not** choose silently.
- **Anticipated failure modes** — for non-trivial changes, name the top 2–3 failure modes the design must handle (per `failure-mode-analysis` categories: null, empty, large, race, partial, network, malformed, boundary). Surfacing these during planning prevents brittle API shapes that lock in bad assumptions before tests are written. Detailed per-test enumeration still happens in `failure-mode-analysis` before TDD Step 1.
- **Blocking questions** — max 3, only if truly blocking.

If blocking ambiguity exists → STOP and ask. Do not proceed.

If the change is high-risk (public API, auth, payments, data migration, security-sensitive behavior) → restate requirements explicitly before any plan.

## Step 1 — The plan

3–8 steps. For each step:

```
N. <step>
   verify: <test or check that proves it's done>
   files: <paths to touch>
   API impact: <breaking? backward-compat strategy?>
   tests: <unit / integration / contract>
   risk: <security / perf / behavior notes>
```

Success criteria MUST be explicit and falsifiable.

## Re-plan trigger conditions

Stop and re-plan when:
- New evidence contradicts an assumption.
- A test fails for an unexpected reason.
- Scope expands.
- The architecture choice proves weak in practice.
- The fix starts feeling hacky, fragile, or high-risk.

Do **not** keep pushing on a flawed plan.

## Output format

Plan goes in the response (or a plan file when a plan-mode tool is active). When the user later asks to execute, refer back to plan steps by number.

## Anti-patterns

- "I'll figure it out as I go" for non-trivial work.
- Silently picking one of several valid interpretations.
- Plans without `verify:` clauses.
- Plans that mix the requirements gate with the implementation steps.
- Vague success criteria ("works", "looks good", "is fast").
