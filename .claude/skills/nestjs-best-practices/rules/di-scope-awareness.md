---
title: Understand Provider Scopes
impact: CRITICAL
impactDescription: Prevents data leaks and performance issues
tags: dependency-injection, scopes, request-context
---

## Understand Provider Scopes

NestJS providers are singletons by default. Most providers should stay singletons. Reach for `Scope.REQUEST` only when per-request state is genuinely required (multi-tenancy, request-correlation). Singleton with mutable instance state is a CRITICAL bug — concurrent requests overwrite each other's data.

> ⚠️ **Approach gate (per `nestjs-best-practices/SKILL.md` "How rules are structured"):** The "Understand scopes" rule itself uses NestJS built-ins (no dep). However, the rule's "Best" example below recommends `nestjs-cls` for async context propagation. **Before adopting that section, ASK the user which approach they prefer:**
>
> > "Async request context can be implemented two ways:
> > - **Approach A — Custom abstraction (no new deps):** Use Node's built-in `AsyncLocalStorage` from `node:async_hooks` directly.
> > - **Approach B — Library:** install `nestjs-cls` for the same capability with NestJS-aware ergonomics.
> >
> > Which approach should I use?"
>
> Wait for explicit response. Do NOT silently choose.
>
> Note: scope choice itself (`DEFAULT` / `REQUEST` / `TRANSIENT`) is NOT gated — those are NestJS built-in mechanisms. Only the async-context-propagation library choice is gated.

## Outcome

- Stateless services are singletons (default). Most providers fall here.
- Per-request state lives in request-scoped providers OR in async-context propagation (one of A/B above).
- No mutable instance state on singleton providers — that's a concurrency bug.
- Scope cascade understood: a `REQUEST`-scoped provider taints every consumer of it.

## Approach A — Custom abstraction (no new deps): `AsyncLocalStorage` directly

Use Node's built-in `AsyncLocalStorage` from `node:async_hooks` for request context. This is what `nestjs-cls` wraps under the hood — using it directly is a fully-supported, dep-free path.

```ts
// src/shared/infrastructure/request-context.ts
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  userId?: string;
  organizationId?: string;
}

export const RequestContextStore = new AsyncLocalStorage<RequestContext>();

export function currentRequestContext(): RequestContext | undefined {
  return RequestContextStore.getStore();
}
```

Stamp the context in middleware:

```ts
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const ctx: RequestContext = {
      requestId: (req.headers['x-request-id'] as string) ?? randomUUID(),
      userId: (req as any).session?.userId,
      organizationId: (req as any).session?.activeOrganizationId,
    };
    RequestContextStore.run(ctx, () => next());
  }
}
```

Consume in singleton services (no scope cascade):

```ts
@Injectable() // SINGLETON — preferred
export class AuditService {
  constructor(private readonly logger: LoggerService) {}

  log(action: string) {
    const ctx = currentRequestContext();
    this.logger.info('audit', { action, userId: ctx?.userId });
  }
}
```

The service stays singleton. No request-scope cascade. Tests can `RequestContextStore.run({...}, () => svc.log(...))` to inject context.

**General scope rules (regardless of A or B):**

```ts
// ✅ Singleton for stateless services (default, most common)
@Injectable()
export class UsersService {
  constructor(private readonly userRepo: UserRepository) {}

  async findById(id: string): Promise<User> {
    return this.userRepo.findOne({ where: { id } });
  }
}

// ✅ Request-scoped ONLY when you need per-request state and async-context isn't viable
@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  constructor(@Inject(REQUEST) private readonly req: Request) {}

  get tenantId(): string {
    return (this.req as any).session?.activeOrganizationId;
  }
}
// Cost: every consumer of TenantContextService is now request-scoped (taint propagates).
```

**Anti-pattern (CRITICAL bug):**

```ts
// ❌ Singleton with mutable request state
@Injectable() // Default: singleton
export class RequestContextService {
  private userId: string; // DANGER: Shared across all concurrent requests!

  setUser(userId: string) {
    this.userId = userId; // Concurrent requests overwrite each other
  }

  getUser() {
    return this.userId; // Returns whichever request wrote last
  }
}
```

**Anti-pattern (perf hit):**

```ts
// ❌ Request-scoped when not needed
@Injectable({ scope: Scope.REQUEST })
export class UsersService {
  // Creates a new instance for EVERY request
  // All dependencies (repo, etc.) also become request-scoped
  async findAll() {
    return this.userRepo.find();
  }
}
```

## Approach B — Library: `nestjs-cls` ⚠️ Adoption-gated

> ⚠️ Adopting this approach adds `nestjs-cls` to `package.json`. **Do NOT implement this section without explicit user approval.** Note: `nestjs-cls` is a NestJS-aware wrapper around Node's `AsyncLocalStorage` — it provides ergonomic NestJS integration but the underlying mechanism is identical to Approach A.

```typescript
// Best: Use ClsModule for async context (no scope bubble-up)
import { ClsService } from 'nestjs-cls';

@Injectable() // Stays singleton!
export class AuditService {
  constructor(private cls: ClsService) {}

  log(action: string) {
    const userId = this.cls.get('userId');
    console.log(`User ${userId} performed ${action}`);
  }
}

// Wire ClsModule globally
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true, generateId: true },
    }),
  ],
})
export class AppModule {}
```

Reference: [NestJS Injection Scopes](https://docs.nestjs.com/fundamentals/injection-scopes)
