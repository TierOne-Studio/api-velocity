---
name: async-error-handling
description: Use when writing or reviewing async code in Node.js — Promise composition (Promise.all/allSettled/race), error propagation, AbortSignal/timeouts, top-level handlers, where to catch vs let propagate. NOT for synchronous code, framework-internal lifecycle handlers, or simple sequential awaits with no error-flow decision.
---

# Async Error Handling

The most LLM-error-prone area in Node.js. The default model habits — wrapping every method in try/catch, returning `null` instead of throwing, defensively retrying — actively violate this codebase's fail-fast principle. This skill encodes the correct patterns and the failure modes to catch.

## When this fires

- Composing parallel async work (`Promise.all`, `Promise.allSettled`, `Promise.race`).
- Calling external services (HTTP, DB) where partial failure is possible.
- Implementing timeouts, cancellation, or backpressure.
- Choosing where in a layered call chain to catch a specific error.
- Reviewing existing async code for silent-failure or wrong-layer-catch issues.

## When this does NOT fire

- Single `await` followed by `return` with no error-flow decision.
- Synchronous control flow.
- NestJS lifecycle hooks (`onModuleInit`, `onApplicationBootstrap`) — these have framework-defined error semantics; just `await` and let it throw.

## Core rules (override LLM defaults)

1. **Throw, don't return null.** This codebase uses NestJS exceptions (`ForbiddenException`, `BadRequestException`, etc.). Returning `null` to signal failure forces every caller to check, drops error context, and violates explicitness.

2. **Catch at the boundary, not at every layer.** A repository throws → the service lets it propagate → the controller's exception filter maps it to HTTP. Catching mid-stack only to rethrow is noise.

3. **Never catch-and-ignore.** `try { ... } catch {}` is forbidden. If you genuinely don't care about the error, log at `warn` with context AND comment why ignoring is correct.

4. **No retries.** Per CLAUDE.md P5. The caller decides retry policy; let the failure propagate with timing/URL/status context.

5. **Fail fast at boundaries.** Validate inputs at the controller; surface invalid state at the entry point. Don't let bad data flow into the domain layer and crash unexpectedly.

## Promise composition (decision tree)

```
Multiple async ops, all must succeed:        Promise.all
Multiple async ops, partial success is OK:   Promise.allSettled
Take whichever completes first:              Promise.race
First success, ignore rejections:            Promise.any
Sequential dependence (b uses a's result):   await a; await b
Parallel-independent in a loop:              Promise.all(items.map(...))
Sequential in a loop:                         for-of with await (NOT .forEach)
```

### Common LLM mistake: `await` inside `.map()` is parallel, not sequential

```ts
// ❌ This runs all in parallel — items[i] doesn't wait for items[i-1]
items.map(async (item) => await processOne(item))

// ✅ Parallel (when that's what you want):
await Promise.all(items.map(item => processOne(item)))

// ✅ Sequential (when each step depends on the previous):
for (const item of items) {
  await processOne(item)
}
```

### Common LLM mistake: `Promise.all` when one rejection is acceptable

```ts
// ❌ Fetching from 3 data sources; one failure kills everything
const results = await Promise.all(sources.map(s => s.search(query)))

// ✅ Per-source independence (chat-agent style):
const settled = await Promise.allSettled(sources.map(s => s.search(query)))
const ok = settled.filter(r => r.status === 'fulfilled').map(r => r.value)
const failed = settled.filter(r => r.status === 'rejected')
if (failed.length > 0) this.logger.warn('partial source failure', { failedCount: failed.length })
return ok
```

This pattern fits the chat agent in this repo: each data source is independent; one timeout shouldn't blank the response.

## Try/catch placement: at the boundary

The model habit is to wrap every method:

```ts
// ❌ Defensive try/catch everywhere — kills typed errors, adds noise, hides root cause
async findOne(id: string) {
  try {
    return await this.repo.findById(id)
  } catch (e) {
    this.logger.error('find failed', e)
    throw e   // re-throwing means the catch did nothing useful
  }
}
```

The correct shape: let typed exceptions propagate; catch only when you're transforming or genuinely handling.

```ts
// ✅ Repo throws ForbiddenException; service propagates; NestJS maps to 403
async findOne(id: string, organizationId: string) {
  const project = await this.repo.findById(id, organizationId)
  if (!project) throw new NotFoundException(`Project ${id} not found`)
  return project
}
```

### Valid reasons to catch

- **Transform** — catch low-level error, throw a higher-level one with more context.
- **Recover** — catch a specific failure mode and substitute a fallback (rare; prove the fallback is correct).
- **Boundary fan-in** — at a chat-agent or API gateway level, mapping multiple kinds of upstream errors to a uniform response.

### Forbidden reasons to catch

- "Just to log" — the exception filter logs already.
- "Just to be safe" — defensive programming becomes silent failure.
- "Because the linter complained" — fix the linter rule.
- "To return `null` instead" — see core rule #1.

## Timeouts and cancellation

Use `AbortSignal.timeout(ms)` (Node 18+) for outbound calls. Propagate the signal so cancellation cascades.

```ts
async fetchExternal(query: string, signal?: AbortSignal): Promise<Result> {
  const timeoutSignal = AbortSignal.timeout(5_000)
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  const res = await fetch(this.url, { signal: combined })
  if (!res.ok) throw new HttpException(`upstream ${res.status}`, res.status)
  return res.json()
}
```

### Common LLM mistake: timeout via `Promise.race` without cleanup

```ts
// ❌ Operation continues running after race completes; resource leak
await Promise.race([slowOp(), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 5000))])

// ✅ AbortSignal cancels the underlying op
await fetch(url, { signal: AbortSignal.timeout(5000) })
```

## Top-level handlers

Node 15+ crashes on unhandled rejections by default. **Don't add `process.on('unhandledRejection')` to swallow them — that defeats the safety.** NestJS's exception filter handles request-scoped errors; for true top-level (e.g., a setInterval callback), wrap the callback body in try/catch and log + decide.

## Common LLM mistakes (catch these in `code-reviewer`)

1. **Defensive try/catch around every await.** Each one obliterates typed errors. Catch only when transforming or recovering.
2. **Returning `null` on failure.** Throw a NestJS exception with context.
3. **`await` inside `.map()` thinking it's sequential.** It runs in parallel.
4. **`.forEach(async ...)`.** Doesn't await — fire-and-forget. Use `for-of` or `Promise.all(map)`.
5. **`Promise.all` when partial-success is acceptable.** Use `Promise.allSettled`.
6. **Custom timeout via `Promise.race`.** Use `AbortSignal.timeout()`.
7. **Catching to log then re-throw.** The filter logs. The catch does nothing.
8. **Adding retries.** Forbidden by CLAUDE.md P5. The caller decides.
9. **Async functions returning `Promise<void>` and the caller not awaiting** — fire-and-forget. The error vanishes.
10. **`async` keyword on a function that has no `await`.** Wraps the return value in a Promise needlessly. Drop the keyword.

## Repo-fit examples

- `ChatAgentService` — parallel per-source search across `ProjectDataSource[]`. Should use `Promise.allSettled` so one source's failure doesn't blank the response. Filter to `ready` sources first (per `repo-conventions`).
- Repository methods (`*.database-repository.ts`) — let DB errors propagate; the service throws domain exceptions (`NotFoundException` etc.); the exception filter maps to HTTP.
- External HTTP calls (Airweave, etc.) — wrap in `AbortSignal.timeout()`; throw `HttpException` on non-2xx; let it propagate.

## Cross-references

- `repo-conventions` § "Error handling" — NestJS exception types this codebase uses.
- `nestjs-patterns/patterns/cross-cutting.md` — exception filter is the boundary handler.
- `failure-mode-analysis` — `network` and `partial` categories enumerate failure modes this skill helps handle.
- `CLAUDE.md` P5 — fail-fast, no retries, root-cause focus.
