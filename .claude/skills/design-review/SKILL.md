---
name: design-review
description: Use BEFORE declaring any code change complete. Reviews the change against SOLID, DRY, KISS, SoC, YAGNI, cohesion/coupling, fail-fast, explicitness, single source of truth, and the SHOULD heuristics. Required for all executable-code deliverables. NOT for non-code outputs (docs, content, JQL, SQL reads, plain explanations).
---

# Design Review

Single focused pass at the end of an implementation. This is a workflow expectation enforced by process and verified by `.claude/tests/run-acceptance.sh`, not by a runtime hook. For executable-code changes, the response MUST include a `Design review:` block plus a `Confidence:` line, or a valid `design-review waived — …` line.

## Output format (required)

Include this block in the response, after the implementation and how-to-run sections:

```
Design review:
- SOLID:        pass / pass-with-note / fail — <one-line note>
- DRY:          ...
- KISS:         ...
- SoC:          ...
- YAGNI:        ...
- Cohesion/coupling: ...
- Fail-fast:    ...
- Explicitness: ...
- SSoT:         ...
- Trade-offs:   <which principle was traded off and why, if any>

Confidence: 0.XX
```

If a principle was deliberately traded off, state it explicitly. Conflict resolution order: **correctness → simplicity → clarity → maintainability**.

## MUST principles (hard gates)

### SOLID
- Keep responsibilities cohesive and bounded.
- Avoid designs where unrelated reasons for change affect the same unit.
- Prefer extension over modification when it keeps the design simpler and safer.
- Preserve substitutability where abstractions exist.
- Keep interfaces and contracts focused and minimal.
- Depend on stable abstractions at boundaries (infrastructure, integrations).

### DRY
- Eliminate duplication when it creates maintenance, correctness, or consistency risk.
- Consolidate repeated business rules, transformations, validations, and mappings into a single trusted implementation.
- Do NOT create premature abstractions for trivial or one-off duplication.
- Preserve readability while removing duplication.

### KISS
- Choose the simplest solution that fully satisfies the requirement.
- Reject unnecessary indirection, abstraction, configurability, or layering.
- Optimize first for readability, maintainability, and correctness.
- If a solution is longer, more generic, or more configurable than necessary, simplify before declaring done.

### SoC (Separation of Concerns)
- Separate orchestration, business logic, persistence, transport, integration, and presentation concerns.
- Keep domain logic out of framework glue and transport handlers where practical.
- Avoid mixing unrelated responsibilities in the same file/class/function.

### YAGNI
- Implement only what the current task requires.
- No speculative abstractions, future-proofing, or extensibility "just in case".
- No options/flags/hooks not justified by current requirements.
- No error handling for unsupported, impossible-by-contract, or unproven scenarios.
- **Deletion test** (when reviewing an abstraction): mentally delete the module/wrapper/interface. If complexity vanishes, it was a pass-through — DELETE it inline. If complexity reappears across N callers, it was earning its keep — keep it.
- **One/two-adapter rule** (for seams): one adapter implementing an interface is a hypothetical seam — collapse the abstraction; inline the concrete implementation. Two real adapters = real seam, keep the interface. "We might add another implementation someday" is a YAGNI failure.

### High Cohesion / Low Coupling
- Each module focused on one clear purpose.
- Minimize cross-module knowledge of internals.
- Favor stable interfaces between components.

### Fail Fast
- Detect invalid states, inputs, and broken assumptions as early as possible.
- Fail with actionable, specific errors — never silent failure or ambiguous fallback.
- Surface enough context for debugging while protecting sensitive data.
- **Never** add retries; never patch with try/catch when the underlying logic is wrong.

### Explicitness over Magic
- Make control flow, data flow, dependencies, and side effects easy to see.
- Prefer explicit contracts over hidden behavior.
- Avoid cleverness that reduces maintainability.

### Single Source of Truth
- Each business rule, state model, validation rule, and mapping rule in one authoritative place.
- Keep derived values derived, not independently maintained.
- Make the true source of behavior obvious in code.

## SHOULD principles (heuristics)

- **Least Astonishment** — behavior matches what a competent engineer would expect.
- **Composition over Inheritance** — small composable units over deep hierarchies.
- **Tell, Don't Ask** — place behavior near the data that owns it.
- **Law of Demeter** — interact through stable boundaries; avoid deep traversal.
- **Convention over Configuration** — sensible defaults; configure only where it adds real value.
- **Idempotency** — repeated operations safe under retries/duplicates (when distributed behavior matters).
- **Immutability where Practical** — predictable state transitions; minimize shared mutable state.

## Pre-done checklist (11 items)

1. Is the solution as simple as possible?
2. No unnecessary duplication?
3. Responsibilities clearly separated?
4. High cohesion, low coupling?
5. Behavior explicit, not surprising?
6. Business rules in exactly one place?
7. Errors are typed, actionable, and redacted?
8. No retries; no try/catch as bandage?
9. No speculative design or unused abstractions?
10. Backward compatibility preserved (unless told otherwise)?
11. Confidence ≥ 0.9?

If any answer is "no", revise before declaring done.

## Anti-patterns (with concrete examples)

### try/catch as fix
```ts
// Bad — swallows the real problem
try { return await this.service.doIt() }
catch { return null }

// Good — validate at boundary, surface failures
const input = validateOrThrow(req.body)
return this.service.doIt(input)
```

### Retry as fix
```ts
// Bad — masks the underlying failure, makes debugging impossible
for (let i = 0; i < 3; i++) {
  try { return await fetch(url) } catch {}
}

// Good — fail fast with actionable error; let the caller decide retry policy
return await fetch(url)  // throws on failure with timing/url/status context
```

### Manager / Helper / Util naming
```ts
// Bad — what does this *actually* do?
class ProjectManager { ... }
class AuthHelper { ... }
function stringUtil(s: string) { ... }

// Good — name describes the responsibility
class OrgScopedProjectFinder { ... }
class JwtIssuer { ... }
function slugify(name: string) { ... }
```

### Premature abstraction
```ts
// Bad — generic interface for ONE concrete caller
abstract class BaseService<T extends BaseEntity, R extends Repository<T>> { ... }
class ProjectService extends BaseService<Project, ProjectRepo> { ... }
// (no second consumer exists)

// Good — concrete now, generalize when caller #2 appears
class ProjectService { ... }
```

### Configuration flags "for future flexibility"
```ts
// Bad — flag with no path that uses false
constructor(private readonly opts: { enableNewFlow?: boolean = true }) {}
if (this.opts.enableNewFlow) { ... } else { /* never reached */ }

// Good — implement the second behavior when it actually arrives
// (until then, no flag at all)
```

### Hidden side effects in getters
```ts
// Bad — refresh on read is invisible to callers
get user() { this.refreshSession(); return this._user }

// Good — explicit method
async getUser() { await this.refreshSession(); return this._user }
```

### Wrapping every call in try/catch with generic logging
```ts
// Bad — every method becomes a void log statement; lose structured errors
try { ... } catch (e) { logger.error('something failed', e); throw e }

// Good — let typed errors propagate; map at the boundary filter once
```

## Anti-patterns (general list, no example)

- Asserting on internals in tests (private methods, mock interactions) instead of observable behavior.
- Using `any` to silence TS rather than fixing the type.
- Returning union types like `T | null | undefined | Error` instead of throwing or returning a discriminated union.
- Building complex inheritance chains when composition would do.
- "Just add a flag" to keep both old and new behavior alive forever.

## Confidence calibration rubric

**The 5-item rubric and the 0.9 gate live in `CLAUDE.md` §P8.1** (always-loaded so the rule applies even if this skill doesn't fire). This section provides the calibration depth: anchors per band, the output format, and the "never round up" principle.

### Calibration anchors (concrete examples of each band)

**0.95–1.00** — All rubric items earned. Tests fully cover the changed code path including error paths. No HIGH/MED from any reviewer. No open assumptions. Refactor would be cosmetic.
*Example:* "Added `scope=owner` check to `projects.findAll`, with failing test demonstrating cross-user leakage before the fix. Full suite green. code-reviewer + qa-validator + security-reviewer all APPROVE."

**0.85–0.94** — All rubric items earned, but one is partial: tests pass but a domain reviewer wasn't run, OR an assumption is unvalidated, OR a MED finding from a reviewer was acknowledged but not yet fixed.
*Example:* "Implementation done, tests pass, design clean, but I didn't run security-reviewer on this auth change because the change was tiny — should have."

**0.70–0.84** — Multiple rubric items partial. Implementation works but verification is thin. Reasonable for a draft; not for a declared-done.
*Example:* "Tests cover happy path only. Edge cases enumerated but not yet tested. code-reviewer not run."

**< 0.70** — Implementation may not even work as claimed, OR no verification at all. Not declarable done. Stop and revise.

NEVER round up. If two rubric items are at 0.10/0.20, your confidence is 0.80, not 0.90. The user uses this number to decide whether to ship.

Output format for the rubric (include after the principle grid):

```
Confidence rubric:
- Tests pass:                  0.20 / 0.20  [✓ ran <suite>, all green]
- Principles checked:          0.20 / 0.20  [✓ 9/9 MUST, grid above]
- No HIGH from reviewers:      0.20 / 0.20  [✓ code-reviewer APPROVE, qa-validator PASS]
- Domain gates passed:         0.20 / 0.20  [N/A — no auth/payments/RBAC touched]
- No open assumptions:         0.20 / 0.20  [✓ all stated assumptions validated]

Confidence: 1.00
```

The numbers are not theatre — they are the rubric outcome. Lying to yourself on the rubric is a worse sin than reporting low confidence honestly.

## Output contract — quality criteria per item

The CLAUDE.md output contract lists 10 items. Each has a *quality bar* that distinguishes a solid deliverable from a sloppy one:

1. **Requirements checklist** — Falsifiable bullets. "User can do X with input Y and see result Z." Not "feature works".
2. **Working Set / REPL transcript** — Only if context is large/dense. Cite evidence (file:line). No bullet without a source.
3. **Plan** — 3–8 steps. Each step has `verify:` clause. No step without verifier. Risks named per step.
4. **Changeset summary** — Files + line counts + one-line per file. Skim test: a reviewer should know what changed in 30 seconds.
5. **Tests (FIRST)** — Failing tests written before implementation. Test code appears BEFORE implementation in the response, not after.
6. **Implementation (SECOND)** — Minimal. Each function traces to a test. No speculative branches.
7. **How to run / verify** — Exact commands, copy-pasteable. Not "run the tests" — `npm test -- projects.spec.ts`.
8. **Design review block** — Principle grid + trade-offs (what was traded off and why) + the calibration rubric.
9. **Confidence** — Rubric outcome. Cite which rubric items earned and which didn't.
10. **Optional improvements** — Proposals only, no implementation. Each with estimated cost + estimated value, so the user can prioritize.

A response that ticks every box at this quality bar is a *senior-staff-engineer-quality* deliverable. Anything less is a draft.
