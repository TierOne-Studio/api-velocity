---
name: decision-rules
description: Use when interpreting an ambiguous user request, when scope is unclear, when a test fails but looks wrong, when CLAUDE.md and a skill seem to disagree, or whenever a default decision is needed under uncertainty. Provides the full decision table with rationale per row. NOT for unambiguous requests, code-quality questions (use design-review), or workflow procedures (use plan-mode / tdd-workflow).
---

# Decision Rules — Defaults Under Ambiguity

CLAUDE.md carries the highest-impact decisions as one-liners. This skill carries the **full table with rationale per row** for when you want depth or you hit a case the CLAUDE.md summary doesn't directly cover.

## Use this skill when

- The user's request is ambiguous and you need to pick a default rather than ask (or to *justify* asking).
- Scope is unclear: is the implied work in or out?
- A test fails but looks wrong — which to trust?
- CLAUDE.md and a skill seem to give different guidance.
- You're about to make a judgment call that will be easier to defend later if you cite the rule.

## Full decision table

### 1. Bug fix scope

**Situation:** User says "fix this bug" and you notice adjacent code that's also broken or smelly.
**Default:** Fix only the named bug. Surgical. Mention the adjacent issue as a follow-up: "While here I noticed <X>; want me to fix it as a separate change?"
**Rationale:** Bundling a fix with a refactor makes the diff harder to review and the bisect harder if a regression appears. Adjacent fixes look free; they aren't.
**Override:** If the adjacent issue is the *cause* of the named bug, the fix necessarily includes it — say so.

### 2. Feature add — test infrastructure

**Situation:** User says "add feature X." The repo has no test infrastructure (or none for this surface).
**Default:** Don't scaffold the test infra. Implement the feature, propose the test infra as a separate task: "I can add this with a manual verification step, OR set up the test rig as a follow-up. Which?"
**Rationale:** Test infra setup is its own work item. Bundling it changes the cost estimate and review surface.
**Override:** If the infra absence *blocks* writing the failing test (mandated by `tdd-workflow`), add the minimum infra needed and call it out explicitly.

### 3. Failing test that looks wrong

**Situation:** A test is failing. On reading, the test's assertion seems incorrect or out-of-date.
**Default:** Stop and ask. Default assumption: **the code regressed; the test asserts the previous correct behavior**.
**Rationale:** Tests rot less often than code. The asymmetry of cost is huge — fixing the test when the code was actually wrong is a silent regression; fixing the code when the test was wrong wastes a few minutes.
**Override:** If `git blame` shows the test was changed yesterday and the code shipped a year ago, the test is the suspect. Even then, ask before changing it.

### 4. "Make it faster"

**Situation:** User requests performance improvement.
**Default:** Profile first. Identify the bottleneck. Then propose targeted change with measured impact.
**Rationale:** Speculative caching, indexing, or memoization usually helps somewhere other than where the actual hotspot is. Without measurement, "faster" optimizations often add complexity for no perceptible gain.
**Override:** If the bottleneck is obvious (e.g., O(n²) over a known-large list, N+1 query) and the fix is clearly in-scope, propose it directly with the rationale.

### 5. "Make it cleaner"

**Situation:** User asks for cleanup of an area.
**Default:** Surgical. One pass. Same scope as the original ask. Stop after one round.
**Rationale:** "Cleanup" has unbounded scope by default; one pass produces a reviewable diff. Multiple passes turn into a refactor of the entire module.
**Override:** If the user explicitly asks for "a comprehensive cleanup of <module>", scope expands to that module and you should plan it via `plan-mode`.

### 6. CLAUDE.md vs skill guidance conflict (P3.5)

**Situation:** A skill says one thing, CLAUDE.md / `repo-conventions` says another.
**Default:** **Follow the skill when it applies.** Skills are the team's curated best-practice catalog and are the default source for situational guidance.
**Override — structural refactor:** If applying the skill would force a structural change to the repo — installing a new dependency, adding cross-cutting infrastructure the repo lacks (global filter, global ValidationPipe, app-wide logger swap, request-id middleware), modifying app-wide bootstrap, or refactoring established patterns in unrelated modules — **follow CLAUDE.md / `repo-conventions` for the current PR** and recommend the skill's pattern as a Future task in the response's Optional Improvements section.
**Rationale:** Skills express the destination; CLAUDE.md sets the boundary conditions for what counts as in-scope for the current change. Smuggling structural refactors into unrelated work is itself a scope-discipline violation. Within CLAUDE.md, lower P-number wins.
**Test for "structural":** would applying this best practice change code outside the current PR's scope? If yes → repo wins, recommend future task. If no → skill wins, apply now.

**What is NOT structural** (best practice wins, no exception):
- Throwing `NotFoundException` / `ForbiddenException` / `BadRequestException` instead of plain `Error` in NEW service code (per `ADR-003`).
- Wrapping a multi-statement DB write in `db.transaction(...)` for the current change (per `database-transactions` skill).
- Choosing the right Guard vs Pipe vs Interceptor for a NEW cross-cutting concern (per `nestjs-patterns`).
- Using `useFactory:` for a NEW provider with env-driven creation.
- Following the 4-layer module structure for a NEW domain module (per `ADR-009` + `nestjs-clean-architecture`).
**Cross-reference:** This rule is the skill-side mirror of CLAUDE.md P3.5. Both must read the same way; a contradiction here is a docs bug — flag it via `lessons-curator`.
**ADR coupling:** When the structural Approach is eventually adopted (either deferred to a Future task and then implemented, or chosen explicitly in the current PR), the adoption MUST include writing an ADR in `docs/decisions/ADR-NNN-<title>.md`. The Future-task entry in Optional Improvements should name the ADR explicitly: `Future task — adopt <practice> per <skill> § <rule>; write ADR-NNN documenting the rationale.` See `documentation-and-adrs`.

### 7. Skill description matches but feels wrong

**Situation:** A skill loaded because its description matches, but its content doesn't fit the actual task.
**Default:** Skip the skill. Don't force-fit. Note in the response that the skill triggered but wasn't applicable.
**Rationale:** Description-triggering is approximate. Forcing a poor match into the response degrades quality. Better to surface the misfire so the description can be sharpened.
**Override:** None. Forcing a misfit skill is always worse than ignoring it.

### 8. Ambiguous reply on approval-required operation

**Situation:** You output the pre-action protocol with `Awaiting approval`. The user replies `"ok"`, `"sounds good"`, `"sure"`, or just 👍.
**Default:** Treat as **NOT approval**. Re-ask with the exact phrasing: "Just to confirm — reply `approve`, `yes`, or `go ahead` to proceed, or anything else to cancel."
**Rationale:** Ambiguous replies are common, but the cost of running an unauthorized destructive operation is asymmetric. Better to look pedantic than to run `DELETE` on a misread thumbs-up.
**Override:** None. The protocol is non-negotiable.

### 9. Confidence rubric scores below 0.90

**Situation:** Computing the calibration rubric in `design-review`, the sum is 0.85.
**Default:** Identify the weakest item, fix it, re-score. **NEVER round up.**
**Rationale:** The Confidence number is what the user uses to decide whether to ship. Inflated confidence is worse than honest low confidence — it leads to surprises in production.
**Override:** None. If the rubric won't lift to 0.90 with reasonable effort, declare with the actual score and name the gap.

### 10. Multiple reasonable interpretations of the request

**Situation:** The user's request has two or more valid readings.
**Default:** Present the interpretations numbered. Pick one only with the user's explicit choice.
**Rationale:** Picking silently means a 50% chance of doing the wrong thing for the rest of the task. The cost of asking once is much lower than the cost of redoing the work.
**Override:** If the readings differ in ways that are obviously cheap to handle (e.g., a 3-line difference between them), implement the one you'd recommend and surface the other as a question — but still surface it.

## Edge cases not in CLAUDE.md

### 11. Repo conventions vs requested approach

**Situation:** User asks you to do X but X violates a `repo-conventions` rule (e.g., "throw a generic `Error`" when the convention is NestJS exceptions, or "use raw SQL" in a new module without one of the documented justifications for falling back from TypeORM).
**Default:** State the conflict. Ask: "<repo-conventions rule>; want me to deviate explicitly, or follow the convention?"
**Rationale:** The user may have a reason; they may have forgotten; the question is cheap.

### 12. User asks for a quick fix on a sensitive surface

**Situation:** "Just patch this auth bug, ship it." But the change touches `auth/` and would normally trigger `security-reviewer`.
**Default:** Explain the verification gate exists. Offer two paths: (a) the right thing — security-review then ship, OR (b) the user explicitly accepts skipping the gate (they own the risk).
**Rationale:** Auth/payments/sessions/RBAC have asymmetric risk. The user can override but should do so consciously.

### 13. Test passes but you don't trust it

**Situation:** A test passes, but on reading it the assertion seems weak (e.g., asserts on truthiness, not on the actual returned value).
**Default:** Surface as a `qa-validator`-shaped concern. Don't silently approve, don't silently strengthen the test (that's scope creep).
**Rationale:** Weak tests give false confidence. Naming the weakness is the right move.

## Anti-patterns

- Picking silently between interpretations because "either works."
- Rounding up confidence to make the response feel done.
- Citing a CLAUDE.md rule to refuse a request the user clearly wants — explain, don't just refuse.
- Using "scope" as cover to skip work the user explicitly named.
