---
name: tdd-workflow
description: Use ALWAYS when implementing, modifying, or fixing executable code (features, bug fixes, refactors, integrations, performance work, type changes affecting runtime). Use even for "small" or "obvious" changes. NOT for documentation, content drafts, SQL reads, JQL queries, slide decks, config-only changes without behavior impact, plain explanations.
---

# TDD Workflow

Strict test-driven development. This is a workflow expectation, not a runtime hook: write or update a test first, verify it fails for the right reason, then make the minimal code change to pass it. If a change cannot follow TDD, the response MUST include one of the four valid waiver phrases at the bottom of this file.

## Anti-pattern: horizontal slicing (write all tests, then all code)

**DO NOT write all tests first, then all implementation.** That treats RED as "draft every test" and GREEN as "draft every code path", which produces brittle tests:

- Tests written in bulk test *imagined* behavior, not *actual* behavior the code surfaced.
- They test the *shape* of things (signatures, data structures) instead of user-visible behavior.
- They become insensitive — they pass when behavior breaks and fail when behavior is fine.
- You commit to test structure before you understand the implementation.

**Correct: vertical slices via tracer bullets.** One test → one implementation → next test. Each test responds to what the previous cycle taught you.

```
WRONG (horizontal):
  RED:   t1, t2, t3, t4, t5
  GREEN: i1, i2, i3, i4, i5

RIGHT (vertical, tracer-bullet):
  RED→GREEN: t1→i1
  RED→GREEN: t2→i2
  ...
```

When `qa-validator` sees a PR where all tests landed in one commit before any implementation, it flags this as a HIGH coverage-quality finding.

## Step 1 — Failing test FIRST (tracer bullet)

- Write the test before the implementation. The test MUST fail when run, **for the right reason** (asserts the behavior you intend to add — not a syntax/import error).
- Verify the failure: run the test before writing implementation code.
- Cover edge cases and known regression paths in the same step where reasonable.
- **You can't test everything.** Confirm with the user (or the failure-mode-analysis enumeration) which behaviors are critical paths or complex logic vs which are speculative edge cases. Test the former; don't pad the suite with the latter.

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

Before declaring the change complete, verify (in order):
- **Requirement coverage.** Every requirement / acceptance criterion has at least one passing test or an explicit waiver.
- **Assumptions validated.** Every assumption stated up front is either confirmed by the code/tests or recorded as a known risk in the response.
- **Every changed line traces to the request.** No drive-by edits.
- **Errors are actionable** (typed, contextual, redacted). NestJS built-in exceptions, not plain `Error` (see `repo-conventions`).
- **Backward compatibility preserved** unless the user explicitly told you otherwise.
- **Security / performance flags raised explicitly** when applicable: new auth surface, new external call, new SQL, new big-O hot path. If none apply, state "no security/perf flags raised."
- **Confidence ≥ 0.9** per the rubric in `CLAUDE.md` P8.1. If lower, revise the weakest area before declaring done.

The design-principles check is delegated to `design-review`; do not duplicate it here.

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
   - **Diagnostic — the rename test:** if you rename an internal helper without changing its signature or behavior, every test should still pass. If a test breaks, that test was asserting on implementation, not behavior. Refactor the test before relying on it.

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
   - **Mock at system boundaries only.** External APIs (Stripe, OpenAI, email, third-party HTTP), time/randomness, the file system. NOT your own classes or internal collaborators — those should be exercised through real code paths.
   - **Prefer SDK-style interfaces over generic fetchers.** A boundary client with one method per operation (`api.getUser(id)`, `api.createOrder(data)`) is independently mockable per call. A single `api.fetch(endpoint, options)` forces conditional logic inside the mock — fragile, slow to debug. When you write code to talk to a boundary, design the SDK shape first.

8. **No conditional logic in the test.** No `if`/`for`/`switch` in test bodies — those make the test a second implementation that itself can be wrong. Use parameterized tests (`it.each(...)`) instead.

9. **Tests one error path explicitly.** For every non-trivial failure mode (validation failure, downstream timeout, conflict, scope mismatch), have a test that triggers it and asserts on the surfaced error. "It should throw" is not enough — assert on the *kind* of error.
   - **Bad:** `expect(() => fn(bad)).toThrow()`.
   - **Good:** `await expect(fn(bad)).rejects.toThrow(ForbiddenException)` — assert on the NestJS built-in exception type the service actually throws (this repo does not use custom error classes; see `repo-conventions`).

10. **Lives next to the code, named consistently.** Match the project's convention for test file location and suffix. If the codebase uses `*.spec.ts`, don't introduce `*.test.ts`.

A test that meets all 10 is genuinely useful. A test that fails any is a *liability* — gives false confidence, slows refactoring, fights the engineer.

When `qa-validator` reviews your tests, this is the rubric it will apply.

## Waiver phrases (the only four valid)

If the change genuinely doesn't require a test, include exactly one of these in the response:

```
TDD waived — non-code change.
TDD waived — type-only.
TDD waived — config change with no behavior impact.
TDD waived — ADR-only change.
```

The `ADR-only change` waiver applies when the PR is exclusively `docs/decisions/ADR-NNN-*.md` content (rationale, alternatives, consequences) with no executable-code change. The moment the same PR also touches code, the waiver does not apply — the code part needs tests like any other change.

Forbidden non-waivers: "small change", "obvious fix", "trivial", "just a refactor".
