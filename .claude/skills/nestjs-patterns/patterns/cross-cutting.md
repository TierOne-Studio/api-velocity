# NestJS Cross-Cutting: Guards, Pipes, Interceptors, Middleware

The four cross-cutting layers in NestJS look similar but each owns a specific responsibility. Picking the wrong one is one of the most common NestJS antipatterns: authorization stuffed into an interceptor, validation stuffed into a guard, response shaping done in a pipe. This file encodes the decision and the request-pipeline order.

## When this pattern applies

- Adding or modifying authorization logic (RBAC, ownership, feature flags) → Guard.
- Adding or modifying input parsing/validation/transformation → Pipe.
- Adding or modifying response wrapping, timing/logging around the handler, caching, retries → Interceptor.
- Adding pre-Nest plumbing (raw body, CORS, CSRF, request-id assignment) → Middleware.
- Reviewing existing cross-cutting code and unsure if it's in the right layer.

## When this pattern does NOT apply

- The work belongs in a service (it's business logic, not cross-cutting).
- The work is a one-line `if` inside a controller and doesn't need to be reusable.
- Framework-internal NestJS plumbing that's already provided (don't reimplement `ExceptionFilter` for a case `HttpException` already covers).

## The pipeline order (memorize this)

```
HTTP request
  │
  ▼
Middleware            (raw req/res; runs before Nest ever sees the request)
  │
  ▼
Guard                 (authorize: allow / deny)
  │
  ▼
Interceptor (before)  (wrap; can short-circuit, transform request)
  │
  ▼
Pipe                  (transform / validate input arguments)
  │
  ▼
Route handler         (controller method → service → repo)
  │
  ▼
Interceptor (after)   (transform response, log timing, RxJS pipeline)
  │
  ▼
Exception filter      (only if something threw)
  │
  ▼
HTTP response
```

If your code lives in the wrong layer, it runs at the wrong time and against the wrong data.

## Decision tree

```
Q1: Is this about deciding "is this allowed?"
    YES → Guard
    NO  → Q2

Q2: Is this about transforming or validating an input parameter?
    YES → Pipe
    NO  → Q3

Q3: Does it need to run before AND after the handler (timing, response shape, RxJS pipeline)?
    YES → Interceptor
    NO  → Q4

Q4: Does it need to run BEFORE Nest's request lifecycle (raw body, CORS, CSRF, custom protocol)?
    YES → Middleware
    NO  → It's probably not cross-cutting — it's business logic. Put it in a service.
```

## Each layer in detail

### Guard — authorization (binary outcome)

**Returns:** `boolean | Promise<boolean> | Observable<boolean>`. Throws `ForbiddenException` (or returns `false` which Nest converts) on deny.

**Use for:**
- Permission checks (RBAC, scope, ownership).
- Feature flags ("is this user in the experiment?").
- Mode gates ("is the system in maintenance mode?").

**Repo example:** `PermissionsGuard` (`src/shared/guards/permissions.guard.ts`) reads `@RequirePermissions(...)` metadata, resolves the user's effective role, and returns `false` (→ 403 `ForbiddenException`) on mismatch.

**Anti-pattern:** putting validation in a guard.
```ts
// ❌ guards return boolean. Validation belongs in a pipe.
canActivate(ctx: ExecutionContext): boolean {
  const req = ctx.switchToHttp().getRequest()
  if (!req.body.email) return false  // wrong layer — silently 403s when it should 400
  return true
}
```

### Pipe — input transformation and validation

**Returns:** the transformed value. Throws (typically `BadRequestException`) on invalid input.

**Use for:**
- Parsing path/query params (`ParseIntPipe`, `ParseUUIDPipe`).
- Validating request bodies (note: this repo does NOT use `class-validator`; see `repo-conventions`).
- Defaults (`DefaultValuePipe`).
- Custom transformations (e.g., trimming, normalizing case).

**Repo note:** controllers in this repo trust TypeScript shapes and validate manually. If you add a pipe, it should still throw `BadRequestException` (NestJS built-in), never plain `Error`.

**Anti-pattern:** doing authorization in a pipe.
```ts
// ❌ pipes don't see the route's auth metadata; they see one parameter
@Injectable()
export class IsOwnerPipe implements PipeTransform {
  transform(value: any) {
    if (value.userId !== currentUser.id) throw new ForbiddenException()  // pipes don't know about currentUser
    return value
  }
}
```

### Interceptor — wrap before/after

**Returns:** an `Observable<T>` (RxJS).

**Use for:**
- Timing / logging (record duration, log inputs/outputs).
- Response transformation (uniform envelope, field redaction).
- Caching (cache hit short-circuits the handler; cache miss runs handler then stores result).
- Retries / timeouts (RxJS operators).
- Exception mapping that needs context the filter can't see (rare).

**Anti-pattern:** putting authorization in an interceptor.
```ts
// ❌ interceptors run AFTER guards. If you check auth here, you've duplicated guard logic
intercept(ctx: ExecutionContext, next: CallHandler) {
  if (!hasPermission(...)) throw new ForbiddenException()  // wrong layer
  return next.handle()
}
```

### Middleware — pre-Nest plumbing

**Returns:** void; calls `next()`.

**Use for:**
- Raw body capture (e.g., for webhook signature verification — must run before body parsers).
- CORS, helmet, CSRF (typically via existing libraries).
- Request-ID assignment (if you don't have it elsewhere; this repo currently doesn't).
- Rare: protocol-level concerns that aren't NestJS-aware.

**Avoid for:** anything that needs `ExecutionContext` (route metadata, handler reference) — middleware doesn't have it. Use a guard or interceptor instead.

## Composition rules

- **Guards don't depend on pipes.** A guard runs before pipes; if you need transformed input for an authorization check, you have a design smell — that decision belongs in the service or in a pipe-then-guard pair via a different abstraction.
- **One concern per class.** A "guard" that also logs and transforms is three things wearing one decorator. Split it.
- **Order within a layer:** when you stack two guards (`@UseGuards(A, B)`), Nest runs them in declaration order. Same for interceptors and pipes.
- **Global vs route-scoped:** apply at the smallest scope that makes sense. Global guards/interceptors are convenient but easy to forget when the next engineer adds a route.

## Common LLM mistakes (catch these in `code-reviewer`)

1. **Authorization in interceptor / pipe / middleware** — wrong layer. Use a guard.
2. **Validation in guard** — guards return boolean; throw `BadRequestException` from a pipe.
3. **Response shaping in pipe** — pipes operate on inputs; use an interceptor for outputs.
4. **Throwing plain `Error`** — always throw NestJS exceptions (per `repo-conventions` § "Error handling").
5. **Reading `req.user` in middleware** — the auth/passport guard hasn't run yet at middleware time. Read `req.user` from a guard or interceptor.
6. **Putting logging in middleware** — works, but loses route metadata. An interceptor with `@Reflector` access logs richer context.
7. **Stuffing multiple concerns into a single interceptor** — split by responsibility.
8. **Using `@UseGuards` globally without considering test impact** — global guards apply to E2E tests too unless overridden.

## Repo-fit examples

| Layer | File | Concern |
|---|---|---|
| Guard | `src/shared/guards/permissions.guard.ts` | RBAC permission check |
| Guard | `src/shared/guards/roles.guard.ts` | Role-based gate |
| Guard | `src/shared/guards/org-role.guard.ts` | Organization role gate |
| Decorator (metadata) | `src/shared/decorators/permissions.decorator.ts` | `@RequirePermissions(...)` consumed by `PermissionsGuard` |
| (no interceptors yet) | — | If you add request-id correlation or response-envelope shaping, an interceptor is the right layer |
| (no middleware yet) | — | If you add webhook-signature verification, that's middleware (raw body) |

## Cross-references

- `repo-conventions` § "RBAC scope contract" — how `PermissionsGuard` and `@RequirePermissions` work together.
- `repo-conventions` § "Error handling" — always throw NestJS exceptions.
- [mixins.md](mixins.md) — for parameterized guards (`RolesGuard(['admin'])`).
- `nestjs-best-practices` § `api-use-pipes`, `api-use-interceptors`, `security-use-guards`.
- `CLAUDE.md` P0.2 + P3.3 — auth/RBAC changes are high-risk and require restate + `security-reviewer`.
