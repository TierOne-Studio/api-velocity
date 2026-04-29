# NestJS Provider Scopes

NestJS providers are **singletons by default**. Most services in a typical app should stay that way. This pattern is the inverse-question: **when should you opt OUT of singleton scope, and what does it cost?**

LLMs default to `Scope.DEFAULT` (the assumption) and don't reach for `REQUEST` when multi-tenancy or per-request context demands it. They also sometimes apply `REQUEST` to stateless services, paying a real perf cost for nothing.

## The three scopes

| Scope | Lifetime | Default? |
|---|---|---|
| `Scope.DEFAULT` | One instance for the whole app (singleton) | YES |
| `Scope.REQUEST` | A new instance per incoming request | NO — opt-in |
| `Scope.TRANSIENT` | A new instance every time the provider is injected | NO — opt-in (rare) |

```ts
// Default — singleton
@Injectable()
export class StatelessFormatter {}

// Request-scoped — new instance per request
@Injectable({ scope: Scope.REQUEST })
export class RequestContext {
  constructor(@Inject(REQUEST) private readonly req: Request) {}
  get currentUserId() { return (this.req as any).session?.userId }
}

// Transient — new instance per injection site
@Injectable({ scope: Scope.TRANSIENT })
export class FreshlyInstantiatedStrategy {}
```

## Decision tree

```
Q1: Does the provider hold per-request or per-user state?
    NO  → Scope.DEFAULT (singleton). Stop here. This is 90%+ of providers.
    YES → Q2

Q2: Should the state reset per HTTP request, or per injection site?
    Per request → Scope.REQUEST
    Per injection site → Scope.TRANSIENT  (rare; usually pluggable strategies, factories that mutate themselves)
```

## When `REQUEST` scope is correct

- A provider that exposes the current user's session, organization, or tenant.
- A provider that accumulates request-scoped state (e.g., a transactional unit-of-work, a request-correlation ID).
- A provider that *itself* depends on the `REQUEST` injection token (`@Inject(REQUEST) private req`).

In **this repo** specifically, `REQUEST` scope would simplify pieces that currently thread the session/org through every method call. A request-scoped `OrgContext` provider could replace passing `organizationId` as a parameter to every repository method. That's a future refactor opportunity — not done today.

## When `REQUEST` scope is WRONG (the 90% case)

- **Stateless services** (formatters, validators, mappers, factories without state). Singleton is correct; request scope adds overhead for no benefit.
- **Services that read the request indirectly** (e.g., a repository that takes `organizationId` as a method parameter). The data flows through arguments, not state — singleton is correct.
- **Services that hold long-lived resources** (DB pool, Redis client). These MUST be singleton; you don't want a new connection pool per request.

## The cost: scope cascades up the dependency chain

This is the part LLMs miss. **If `A` is `REQUEST`-scoped and `B` injects `A`, then `B` is forced to be `REQUEST`-scoped too** — even if `B` doesn't otherwise need to be. The taint propagates upward.

```ts
@Injectable({ scope: Scope.REQUEST })
class OrgContext { /* ... */ }

@Injectable()  // declared default, but...
class ProjectsService {
  constructor(private readonly org: OrgContext) {}
  // ProjectsService is now effectively REQUEST-scoped.
  // Every consumer of ProjectsService must also tolerate per-request lifetime.
}
```

Implication: introducing one request-scoped provider can ripple through the dep graph and impose request-scope semantics on services that don't want them. **Audit the consumers before flipping a singleton to `REQUEST`.**

The taint stops at the boundary of an interceptor / guard that injects via the `REQUEST` token directly — those are already request-aware. So one common pattern is to keep services singleton and read request data in a guard/interceptor (the cross-cutting layer), passing extracted values down as method arguments.

## When `TRANSIENT` is correct (rare)

- A factory that mutates itself between uses and shouldn't share state across consumers.
- A logger that needs to bind context per injection site (Nest's logger uses transient scope under the hood).
- A pluggable strategy where each consumer needs its own configurable instance.

For most app code, `TRANSIENT` is wrong. If you're tempted to use it, ask whether the "configuration" should actually be a method argument.

## Common LLM mistakes (catch these in `architect-reviewer` and `code-reviewer`)

1. **Defaulting to `REQUEST` for "user-aware" services** — the service can be singleton if it accepts the user/org as a method argument. Per-request state is a *last* resort, not a first.

2. **Ignoring scope cascade** — flipping one provider to `REQUEST` and being surprised when downstream services behave differently or perf drops. Trace the consumer chain first.

3. **Putting `REQUEST` on a connection pool** — DB pool, Redis client, HTTP client. These are heavy; singleton is correct.

4. **Using `TRANSIENT` for "freshness"** — usually a smell that the service shouldn't have state at all. Refactor to stateless first.

5. **Forgetting the `inject: [{ token: REQUEST, ... }]` shape for factory providers** — if a factory needs the request, it must declare it.

6. **Reading session in a singleton service via a global** — looks like it works in dev (one user), explodes in prod (multiple concurrent requests sharing global state). If you need per-request state, use `REQUEST` scope or pass it as an argument; never reach for module-level mutable variables.

## Repo-fit examples

- `DatabaseService` — singleton (correct). One DB pool, app-wide.
- `PermissionsGuard` — singleton (default for guards). Reads request data via `ExecutionContext`, not via injected state.
- `resolveOrgScope()` (utility, not a provider) — pure function, takes the request as an argument. No scope question.
- **Hypothetical refactor:** a request-scoped `OrgContext` provider that holds `{ organizationId, effectiveRole }` once per request. Could simplify repository signatures. Cost: every consumer of `OrgContext` becomes request-scoped; benefit: less argument-threading. Trade-off discussion is for `architect-reviewer` if proposed.

## Cross-references

- [factory-providers.md](factory-providers.md) — `useFactory` providers can also declare scope.
- [cross-cutting.md](cross-cutting.md) — guards/interceptors read `request` directly without needing request-scoped DI.
- `nestjs-best-practices` § DI — `di-scope-awareness`.
- `repo-conventions` § "RBAC scope contract" — how org/role data flows through the request today.
