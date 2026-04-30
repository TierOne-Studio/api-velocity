---
name: bug-investigation
description: Use when given a bug report, failing test, CI failure, production incident, or "it's broken" task. NOT for new features, refactors not driven by a defect, design work, or routine code reviews.
---

# Bug Investigation

Find the root cause, prove it with a failing test, fix via TDD, and verify with broader regression coverage. Do not patch symptoms.

## Root-cause discipline test

Before proposing a fix, you MUST be able to answer: **"Why did this bug appear NOW?"** If you can't, you don't have the root cause yet — keep investigating.

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

### Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100×, parallelise, add stress, narrow timing windows, inject sleeps. A 50%-flake bug is debuggable; 1% is not — keep raising the rate.

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
