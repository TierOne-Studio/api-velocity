---
name: bug-investigation
description: Use when given a bug report, failing test, CI failure, production incident, or "it's broken" task. NOT for new features, refactors not driven by a defect, design work, or routine code reviews.
---

# Bug Investigation

Find the root cause, prove it with a failing test, fix via TDD, and verify with broader regression coverage. Do not patch symptoms.

## Root-cause discipline test

Before proposing a fix, you MUST be able to answer: **"Why did this bug appear NOW?"** If you can't, you don't have the root cause yet — keep investigating.

## Stop-the-Line Rule

When anything unexpected happens — failing test, broken build, runtime error, behavior mismatch:

```
1. STOP    — adding features or making unrelated changes.
2. PRESERVE — error output, logs, repro steps, environment details.
3. DIAGNOSE — work the steps below.
4. FIX     — root cause, not symptom.
5. GUARD   — regression test or monitor that will catch this class of bug.
6. RESUME  — only after verification passes.
```

**Don't push past a failing test or broken build to work on the next feature.** Errors compound: a bug in step 3 that goes unfixed makes steps 4–10 wrong.

## Step 1 — Build a feedback loop, then reproduce

**The single highest-leverage activity in debugging is constructing a fast, deterministic, agent-runnable pass/fail signal for the bug.** Once you have one, bisection / hypothesis-testing / instrumentation all just consume it. Without one, no amount of code-reading will save you. **Spend disproportionate effort here.**

### Ranked ways to construct a loop (try in this order)

1. **Failing test** at the seam that reaches the bug — unit, integration, or e2e. Default option, becomes the regression test.
2. **`curl` / HTTP script** against a running dev server.
3. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot.
4. **Headless browser** (Playwright / Puppeteer) — drives the UI; asserts on DOM / console / network.
5. **Replay a captured trace.** Save a real request payload / event log to disk; replay through the code path in isolation.
6. **Throwaway harness.** Minimal subset of the system (one service, mocked deps) that exercises the bug code path with a single function call.
7. **Property / fuzz loop.** If the bug is "sometimes wrong output", run N random inputs and look for the failure mode.
8. **Bisection harness.** If the bug appeared between two known states (commit, dataset, version), automate "boot at state X, check, repeat" so `git bisect run` works.
9. **Differential loop.** Same input through old-version vs new-version (or two configs); diff outputs.
10. **HITL bash script** (last resort). If a human must click, structure the loop so captured output feeds back to you.

### Iterate on the loop itself — treat it as a product

- Faster (cache setup, skip unrelated init, narrow scope).
- Sharper signal (assert on the specific symptom, not "didn't crash").
- More deterministic (pin time, seed RNG, isolate filesystem, freeze network).

A 30-second flaky loop is barely better than no loop. A 2-second deterministic loop is a debugging superpower.

### Non-deterministic bugs — categorize before chasing

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100×, parallelise, add stress, narrow timing windows, inject sleeps. A 50%-flake bug is debuggable; 1% is not — keep raising the rate.

When you can't reproduce on demand, classify the bug first — the right next step depends on the category:

```
Cannot reproduce on demand:
├── Timing-dependent
│   ├── Add timestamps to logs around the suspected area
│   ├── Try with artificial delays (await new Promise(r => setTimeout(r, N))) to widen race windows
│   └── Run under load or concurrency to increase collision probability
├── Environment-dependent
│   ├── Compare Node versions, OS, env vars between repro and non-repro environments
│   ├── Check data differences (empty vs populated org, different RBAC scope)
│   └── Try reproducing in CI where the environment is clean
├── State-dependent
│   ├── Check for leaked state between tests or requests (DB rows from prior test, in-memory caches)
│   ├── Look for global variables, singletons, shared caches
│   └── Run the failing scenario in isolation vs after other operations
└── Truly random (no pattern after the above)
    ├── Add defensive logging at the suspected location
    ├── Set up an alert for the specific error signature
    └── Document the conditions observed and revisit when it recurs
```

### Localize the layer (decision tree)

When the symptom is unclear about which layer is failing:

```
Where does the failure surface?
├── HTTP / controller / public API  → check request log, response body, route guard
├── Service / domain logic          → check service-method inputs, intermediate values
├── Repository / database           → check the executed SQL, parameters, transaction boundary
├── Build / tooling / CI            → check config, dependencies, env vars, runner version
├── External service                → check connectivity, rate limits, contract-compliance, recent vendor changes
└── The test itself                 → false negative: is the test actually correct? (See `tdd-workflow` rubric item 1 — rename test diagnostic.)
```

### Bisect for regressions

If the bug appeared between two known states (a deploy, a dataset version, a dependency bump), automate the check and let `git bisect run` find the introducing commit:

```bash
git bisect start
git bisect bad                      # current HEAD is broken
git bisect good <known-good-sha>    # this commit worked
git bisect run npm test -- --testPathPattern="failing-spec"
```

The script's exit code drives the search (`0` = good, non-zero = bad). Keep the failing check fast — bisection runs it ~log₂(N) times.

### When you genuinely cannot build a loop

Stop and say so explicitly. List what you tried. Ask the user for: (a) access to whatever environment reproduces it, (b) a captured artifact (HAR file, log dump, core dump, screen recording with timestamps), or (c) permission to add temporary instrumentation. Do **not** proceed to hypothesise without a loop.

### Reproduce

Run the loop. Confirm it produces the failure mode the **user** described — not a different failure that happens to be nearby. Wrong bug = wrong fix. Capture the exact symptom (error message, wrong output, slow timing) so later phases can verify the fix.

If the loop is a failing test, it asserts the buggy behavior (not just "throws"), runs deterministically, and will pass once the bug is fixed.

## Step 2 — Investigate

Walk through systematically:
1. **Error message** — what does it say literally? Read the stack trace top-to-bottom and bottom-to-top.
2. **Recent change** — what changed last? `git log` / `git blame` on the affected lines.
3. **Data** — is this a data shape problem? Inspect actual values, not assumed ones.
4. **Boundary** — is this an off-by-one, null, empty array, async race, timezone, locale, encoding?
5. **Assumption** — what did the original author assume that no longer holds?

## Step 3 — Hypothesise (3–5 ranked, falsifiable)

**Generate 3–5 ranked hypotheses BEFORE testing any of them.** Single-hypothesis generation anchors on the first plausible idea and burns time chasing it. Multiple ranked hypotheses force breadth.

Each hypothesis MUST be **falsifiable** — state the prediction it makes:

> Format: "If `<X>` is the cause, then `<changing Y>` will make the bug disappear / `<changing Z>` will make it worse."

If you can't state the prediction, the hypothesis is a vibe — discard or sharpen it.

**Show the ranked list to the user before testing.** They often re-rank instantly with domain knowledge ("we just deployed a change to #3"), or know hypotheses they've already ruled out. Cheap checkpoint, big time saver. Don't block on it — proceed with your ranking if the user is AFK.

## Step 3.5 — Instrument and falsify

Each probe (logging line, assertion, conditional break) MUST map to a specific prediction from Step 3. **Change one variable at a time.** Two simultaneous probes leave you unable to attribute the result.

If a probe disconfirms its hypothesis, cross it off the ranked list and move to the next. If a probe confirms one, you have the cause — proceed to Step 4. If all 3–5 are disconfirmed, return to Step 2 and re-investigate; you missed something.

## Step 4 — Fix via TDD

Delegate to the `tdd-workflow` skill:
- The Step 1 reproduction test is your failing test.
- Implement the minimal fix.
- Run the full suite.

## Step 5 — Regression coverage

Add tests broader than the single reproduction:
- Adjacent inputs (one-off variations).
- Boundary cases the bug suggests are weak.
- The "next bug" — what else could break the same way?

## Step 6 — Post-mortem fragment (production incidents only)

Brief paragraph in the response:
- What happened (user-visible)
- Root cause
- Fix
- How we'll prevent recurrence (test, monitor, type, contract)

## When to escalate vs. proceed autonomously

**Proceed autonomously** when:
- Logs and code are sufficient to find root cause.
- Failing CI is reproducible locally.
- Fix is in-scope and surgical.

**Escalate to user** when:
- Missing permissions/credentials/artifacts block reproduction.
- The "fix" requires a behavior decision (intent ambiguous).
- Multiple reasonable root causes can't be narrowed without external info.

## Anti-patterns

- **Patching symptoms** — wrapping the failure point in `if (!err)` instead of fixing the cause.
- **try/catch as fix** — swallowing the error to make the test pass.
- **Retry as fix** — masking flakiness instead of removing it. Never add retries.
- **Speculative fix** — "this might be it, ship and see." No.
- **Fix without test** — leaves no regression guard.
- **Stopping at the first plausible cause** — keep asking "why now?" until the answer is satisfying.
