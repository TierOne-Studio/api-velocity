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
- **Assumptions — surface immediately.** Output them as a labeled block: `ASSUMPTIONS I'M MAKING:` followed by a numbered list, then `→ Correct me now or I'll proceed with these.` Only list assumptions that affect behavior, architecture, or delivery risk. Silent assumptions are the most dangerous form of misunderstanding — name them so the user can override before any code is written.
- **Multiple interpretations** — if more than one reasonable reading exists, list them. Do **not** choose silently.
- **Anticipated failure modes** — for non-trivial changes, name the top 2–3 failure modes the design must handle (per `failure-mode-analysis` categories: null, empty, large, race, partial, network, malformed, boundary). Surfacing these during planning prevents brittle API shapes that lock in bad assumptions before tests are written. Detailed per-test enumeration still happens in `failure-mode-analysis` before TDD Step 1.
- **Blocking questions** — max 3, only if truly blocking.

If blocking ambiguity exists → STOP and ask. Do not proceed.

If the change is high-risk (public API, auth, payments, data migration, security-sensitive behavior) → restate requirements explicitly before any plan.

### Grill-me mode (escape hatch)

The 3-question cap above is the default. **When the user says "grill me" / "let's grill this" / "stress-test this plan" OR ambiguity is irreducibly deep (multiple unresolved branches in the design tree), switch to grilling mode:**

- Ask **one question at a time, waiting for the user's answer before continuing.** No batched lists.
- For each question, **provide your recommended answer** so the user can react instead of starting from blank.
- Walk down each branch of the design tree, resolving dependencies one-by-one. Don't skip ahead.
- If a question can be answered by exploring the codebase, **explore the codebase instead of asking** — only ask when the code can't tell you.
- Sharpen fuzzy language: when the user uses overloaded terms ("account", "user", "order"), propose a precise canonical term and confirm. Reference `repo-conventions` § Domain glossary if it covers the term.
- Cross-reference with code: when the user states how something works, check whether the code agrees. Surface contradictions: "your code does X, but you just said Y — which is correct?"
- When the design tree is fully walked, return to Step 1 and write the plan with all branches resolved.

## Step 1 — The plan

3–8 steps. For each step:

```
N. <step>
   verify: <test or check that proves it's done>
   files: <paths to touch>
   API impact: <breaking? backward-compat strategy?>
   tests: <unit / integration / contract>
   risk: <security / perf / behavior notes>
   slice: <expected LOC for this step — target ≤ ~100 LOC per step>
```

Success criteria MUST be explicit and falsifiable.

### When the plan introduces a structural decision

If any plan step introduces a load-bearing engineering decision (new persistence layer, new auth library, new public-API contract, app-wide bootstrap change — anything that will be cited from `CLAUDE.md` / `repo-conventions` / a skill), the plan MUST include an explicit step to write the corresponding ADR in `docs/decisions/ADR-NNN-<title>.md`. The ADR step lives alongside the implementation steps with its own `verify:` clause (the file exists, has all required sections, and the index in `docs/decisions/README.md` is updated). See `documentation-and-adrs` for the ADR format.

### Identify the dependency graph BEFORE slicing

Before writing the per-step plan, sketch what depends on what. The dependency graph dictates implementation order — foundations first, consumers last:

```
Database / entity / migration
    │
    ├── Repository (TypeORM or raw-SQL per ADR-001)
    │       │
    │       └── Service / domain logic
    │               │
    │               ├── Controller / DTO
    │               │       │
    │               │       └── Tests (e2e through the controller)
    │               │
    │               └── Internal callers in other modules
```

Plan steps follow the graph bottom-up. Two consequences: (a) early steps unblock multiple later ones; (b) a step that touches both top and bottom of the graph is too wide — split it.

### Slicing strategies (pick one explicitly)

- **Vertical (default — tracer bullet).** Each slice cuts through every layer end-to-end (entity + repo + service + controller + test) for ONE narrow path. Pairs with the ~100-LOC cap. Best when the layer-stack is well-understood and the risk is in the integration.
- **Risk-first.** When there's irreducible technical risk (new external integration, novel concurrency pattern, unproven library), make the first slice prove just the risky piece. If it fails, you discover it before sinking effort into Slices 2..N. Subsequent slices build on the proven path.
- **Contract-first.** When a public API or module boundary is being introduced, **Slice 0 = define the contract** (types / interface / OpenAPI surface). Then Slice 1+ implements behind the contract; consumers can develop in parallel against the same shape. Best fit for new NestJS controllers exposing a route the frontend or another service will consume.

State the choice in the plan output (e.g., `Slicing: contract-first — Slice 0 defines the DTOs and controller signatures; Slice 1 implements the service`). The reviewer (`architect-reviewer`) checks whether the choice matches the actual risk profile.

### Step sizing — tracer-bullet vertical slices (~100 LOC cap)

Each step is a **tracer-bullet vertical slice**: a thin path that cuts through every layer (schema → service → controller → test) end-to-end, NOT a horizontal slice of one layer. A completed slice is demoable or verifiable on its own. Implementable, testable, and committable on its own. Target ≤ ~100 LOC of executable code per step (tests excluded from the count). If a step's implementation crosses ~100 LOC mid-execution, **STOP, commit what's working, and split the rest into a new step.** Don't push through.

The cap is a discipline mechanism, not a hard rule — a 130-LOC step that's genuinely cohesive is fine; a 250-LOC step that's "just three small things" is the failure mode. The split-and-commit reflex catches big-bang implementations that drift from the plan and produce un-reviewable diffs.

When a step legitimately can't be ≤ ~100 LOC (e.g., generated code, large config matrices, copy-paste-y migrations), name it explicitly: `slice: ~250 LOC — generated GraphQL schema, not split-able`. The point is to make the size choice deliberate.

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
