---
name: bug-investigation
description: Use when given a bug report, failing test, CI failure, production incident, or "it's broken" task. NOT for new features, refactors not driven by a defect, design work, or routine code reviews.
---

# Bug Investigation

Find the root cause, prove it with a failing test, fix via TDD, and verify with broader regression coverage. Do not patch symptoms.

## Root-cause discipline test

Before proposing a fix, you MUST be able to answer: **"Why did this bug appear NOW?"** If you can't, you don't have the root cause yet — keep investigating.

## Step 1 — Reproduce

Write a failing test that demonstrates the bug. The test:
- Asserts the buggy behavior, not just "throws an error".
- Runs deterministically.
- Will pass once the bug is fixed.

If a test cannot be written (env issue, external dep), describe the exact reproduction steps in the response.

## Step 2 — Investigate

Walk through systematically:
1. **Error message** — what does it say literally? Read the stack trace top-to-bottom and bottom-to-top.
2. **Recent change** — what changed last? `git log` / `git blame` on the affected lines.
3. **Data** — is this a data shape problem? Inspect actual values, not assumed ones.
4. **Boundary** — is this an off-by-one, null, empty array, async race, timezone, locale, encoding?
5. **Assumption** — what did the original author assume that no longer holds?

## Step 3 — Hypothesis

State a testable hypothesis: "X happens because Y, which I'll prove by Z."

If you can't test the hypothesis cheaply, it's the wrong hypothesis — refine.

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
