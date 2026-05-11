---
name: failure-mode-analysis
description: Use TWICE on non-trivial changes — first during `plan-mode` Step 0 (to anticipate the top 2–3 failure modes that should shape the API design), then again BEFORE writing the failing test in tdd-workflow Step 1 (full enumeration of failure modes — null, empty, large, race, partial, network, malformed, boundary — to decide which tests to write). NOT for trivial single-line edits, type-only changes, documentation, or non-code work.
---

# Failure-Mode Analysis

A 60-second discipline that runs *before* the first test is written. It changes the **implementation** phase, not the review phase — by the time `qa-validator` runs, half the gaps it would have found are already covered.

## When this fires

After the requirements gate (`plan-mode` Step 0) and before the failing test (`tdd-workflow` Step 1). Run it on every non-trivial code change.

Skip on:
- Type-only changes
- Single-line trivial edits
- Documentation / config without behavior impact

## The exercise

For the change you're about to implement, walk **all eight categories** and write one bullet per category — even if the bullet is "N/A here, because <reason>".

### 1. Null / Undefined / Missing

What happens if an input is `null` / `undefined` / missing?
- Direct args
- Optional fields on objects
- Return values from upstream calls (DB, HTTP, cache)

### 2. Empty / Zero

What if the input is structurally valid but empty / zero?
- Empty string, empty array, empty object, `0`, `false`
- Empty result set from a query
- Empty user list, empty permission set

### 3. Boundary / Off-by-one

What's the smallest / largest legal input? What happens at the boundary?
- 0, 1, MAX_INT, MAX_SAFE_INTEGER
- First page, last page, single-element page
- Empty range, single-element range
- Pagination cursor at start / end

### 4. Very large / unbounded

What if the input is much larger than expected?
- 10K-element array, 1MB string, deep object nesting
- Long-running request, timeout
- Memory pressure
- Pagination not used where it should be

### 5. Malformed / wrong type

What if the input is the wrong shape?
- Wrong type (string where number expected)
- Extra fields, missing fields
- Encoding issues (UTF-8 vs Latin-1, BOM, escape sequences)
- Time format mismatch (ISO vs epoch vs Date object)

### 6. Concurrent / race / partial

What if two operations happen at once, or one is interrupted?
- Two writes to the same row
- Read-then-write without a lock
- Partial commit (DB succeeded, downstream failed)
- Retry after partial completion (idempotency)

### 7. External failure

What if the dependency fails or returns unexpected data?
- DB unavailable, slow, returns error
- HTTP call times out, returns 5xx, returns malformed body
- Cache miss, cache stale, cache poisoned
- Third-party rate-limited, deprecated, schema-changed

### 8. Locale / time / encoding

What if the user / system isn't the assumed locale?
- Timezone different from server
- Daylight savings transition
- Locale-dependent formatting (decimal separator, date format)
- Right-to-left strings, emoji, multi-byte characters

## Output format

Include this block in your response BEFORE the test you write:

```
Failure-mode analysis:
- Null/missing:       <covered/N-A — how/why>
- Empty/zero:         <...>
- Boundary:           <...>
- Very large:         <...>
- Malformed:          <...>
- Concurrent/partial: <...>
- External failure:   <...>
- Locale/time:        <...>

Tests planned to cover the non-N/A categories:
- <category>: <test name + assertion>
```

## Decision rule: which failure modes get tests?

You don't need a test for every category. You need a test for every category where:
- The failure mode is **realistic** for this surface (e.g., locale matters for user-facing date display, less so for an internal worker), AND
- The failure mode would cause a **non-obvious** failure (silent corruption, wrong-but-plausible output, swallowed error), OR
- The failure mode crosses a **trust boundary** (input from user / external API / DB).

Categories marked N/A must include a one-clause reason. "N/A — internal-only, types enforce shape" is fine. "N/A — small change" is not.

## Anti-patterns

- Writing the analysis block after the tests are already written (defeats the purpose).
- Marking everything N/A to skip the exercise.
- Confusing this with `design-review` — design-review checks principles; failure-mode-analysis enumerates failure modes. They're different lenses.
- Writing tests for impossible-by-contract failure modes ("what if the type system gave us a string when we declared number?") — fail-fast trusts the contract. YAGNI applies.
- Skipping concurrency because "we're single-threaded" — JS is single-threaded but async; a `await` between read and write is a race window.

## Interaction with other skills

- Runs **inside** `tdd-workflow`, between Step 0 (requirements) and Step 1 (failing test).
- Informs which tests to write in `tdd-workflow` Step 1.
- Reduces the gap-list `qa-validator` will produce post-impl.
- Does NOT replace `design-review` — design-review still runs before declaring done.
