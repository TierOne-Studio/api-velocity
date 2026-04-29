---
name: tdd-workflow
description: Use ALWAYS when implementing, modifying, or fixing executable code (features, bug fixes, refactors, integrations, performance work, type changes affecting runtime). Use even for "small" or "obvious" changes. NOT for documentation, content drafts, SQL reads, JQL queries, slide decks, config-only changes without behavior impact, plain explanations.
---

# TDD Workflow

Strict test-driven development. Mechanically enforced by `enforce-tdd-postedit` (PostToolUse) and `enforce-tdd-stop` (Stop) — turn-end is blocked if source is edited without a test or a valid waiver.

## Step 1 — Failing test FIRST

- Write the test before the implementation. The test MUST fail when run, **for the right reason** (asserts the behavior you intend to add — not a syntax/import error).
- Verify the failure: run the test before writing implementation code.
- Cover edge cases and known regression paths in the same step where reasonable.

## Step 2 — Minimal implementation

- Write the simplest code that makes the test pass.
- No speculative branches. No "while we're here" refactors. No abstractions for a single caller.
- If a new abstraction is needed, prove it with at least 2 concrete callers first.

## Step 3 — Run the FULL test suite

- After every code change, run the **entire** suite, not just the new test, unless the user has explicitly narrowed the scope.
- For changes touching auth, payments, sessions, or PII: run BOTH the unit suite AND the integration suite. Name them explicitly in the response.
- If a test cannot be run in the current environment, output the exact commands the user should run locally / in CI, and state which subsets ran here and why.

## Step 4 — Refactor only if needed

- In-scope only. Tests stay green at every step.
- If refactoring grows beyond the current task, stop and propose it separately.

## Step 5 — Mini self-review

Before declaring the change complete, verify:
- Every changed line traces to the request.
- Errors are actionable (typed, contextual, redacted).
- Backward compatibility preserved unless explicitly told otherwise.
- Confidence ≥ 0.9; if lower, revise the weakest area.

## Interaction with `design-review`

Use `tdd-workflow` *during* implementation. Use `design-review` *at the end*, before declaring complete. One focused pass each — do not interleave principle review with red/green/refactor cycles.

## Anti-patterns

- Writing tests after the implementation ("retroactive TDD")
- Asserting on internals instead of observable behavior
- Mocking the unit under test
- Skipping the failure verification step
- Calling a try/catch a "fix" when the underlying logic is wrong
- Adding retry logic instead of fixing the root cause

## Test quality rubric

A test that *passes* is necessary; a test that's *good* is what catches regressions and lets you refactor without fear. Every test you write must satisfy:

1. **Asserts observable behavior, not internals.** Don't assert on private state, mock-call shapes, or implementation steps. Assert on what a caller would see — return values, side effects on shared state, emitted events, persisted data.
   - **Bad:** `expect(service.cache.get('x')).toBe(...)` — internal cache.
   - **Good:** `expect(await service.fetch('x')).toEqual(...)` — observable result.

2. **Fails for the right reason.** Run the test BEFORE the implementation. It must fail because the assertion isn't satisfied — not because of an import error, missing mock setup, or syntax error. If the test "fails" before you've written a line of code under test, you have a bad test.

3. **Deterministic.** Same input → same output. No `Math.random()`, no `new Date()` without a clock injection, no time-dependent ordering, no reliance on async event-loop ordering across tests.
   - **Bad:** `expect(items).toEqual([a, b, c])` when the underlying code returns them in non-deterministic order.
   - **Good:** `expect(items).toEqual(expect.arrayContaining([a, b, c]))` or sort first.

4. **Named for the behavior.**
   - **Bad:** `it('works')`, `it('test 3')`, `it('should be fine')`.
   - **Good:** `it('returns 403 when user is in a different org')`, `it('rolls back the transaction when downstream call fails')`.

5. **One assertion per behavior.** A test failure should tell you exactly what broke. Multiple assertions are fine if they all describe one behavior; not if they describe four. If you're testing four things, write four tests.

6. **Minimal setup.** If setup is longer than the assertion, the unit under test probably has too many collaborators. Reconsider the design (this is a `design-review` smell). Setup-heavy tests rot fast.

7. **No mocking the unit under test.** If you have to mock parts of the thing you're testing, the unit's collaborators are misshapen. Refactor before testing.

8. **No conditional logic in the test.** No `if`/`for`/`switch` in test bodies — those make the test a second implementation that itself can be wrong. Use parameterized tests (`it.each(...)`) instead.

9. **Tests one error path explicitly.** For every non-trivial failure mode (validation failure, downstream timeout, conflict, scope mismatch), have a test that triggers it and asserts on the surfaced error. "It should throw" is not enough — assert on the *kind* of error.
   - **Bad:** `expect(() => fn(bad)).toThrow()`.
   - **Good:** `await expect(fn(bad)).rejects.toThrow(InvalidScopeError)`.

10. **Lives next to the code, named consistently.** Match the project's convention for test file location and suffix. If the codebase uses `*.spec.ts`, don't introduce `*.test.ts`.

A test that meets all 10 is genuinely useful. A test that fails any is a *liability* — gives false confidence, slows refactoring, fights the engineer.

When `qa-validator` reviews your tests, this is the rubric it will apply.

## Waiver phrases (the only three valid)

If the change genuinely doesn't require a test, include exactly one of these in the response:

```
TDD waived — non-code change.
TDD waived — type-only.
TDD waived — config change with no behavior impact.
```

Forbidden non-waivers: "small change", "obvious fix", "trivial", "just a refactor".
