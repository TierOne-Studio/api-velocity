# NestJS Mixins

A non-obvious NestJS pattern. When a Guard or Interceptor needs to take arguments at usage time (`@UseGuards(RolesGuard(['admin']))`), naive implementations either lose DI ergonomics or break entirely. The `mixin()` helper from `@nestjs/common` is the idiomatic answer, and few engineers — or LLMs — know it exists.

## The problem this solves

You want to write:
```ts
@UseGuards(MinRoleGuard('admin'))
@Get('admin-panel')
adminPanel() { ... }
```

…where `MinRoleGuard` is a Guard that internally needs DI (e.g., `RoleService`, `Reflector`). A naive factory:

```ts
// ❌ Anti-pattern — no DI on the inner class
function MinRoleGuard(minRole: string): Type<CanActivate> {
  return class implements CanActivate {
    canActivate(ctx: ExecutionContext): boolean {
      // No way to inject RoleService here. Stuck with hardcoded logic.
      const userRole = ctx.switchToHttp().getRequest().user?.role
      return userRole === minRole  // brittle, no centralized rule
    }
  }
}
```

The class returned by the factory is anonymous. Nest's DI container doesn't see it as a registered provider, so it can't inject anything into it. You're forced to inline logic that should live in services.

## The fix: `mixin()`

```ts
import { Injectable, mixin, Type } from '@nestjs/common'
import { CanActivate, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

export function MinRoleGuard(minRole: string): Type<CanActivate> {
  @Injectable()
  class _MinRoleGuard implements CanActivate {
    constructor(
      private readonly reflector: Reflector,   // ✅ injected
      private readonly roleService: RoleService,  // ✅ injected
    ) {}

    canActivate(ctx: ExecutionContext): boolean {
      const userRole = this.roleService.getEffectiveRole(ctx)
      return this.roleService.compare(userRole, minRole) >= 0
    }
  }

  return mixin(_MinRoleGuard)
}
```

`mixin()` registers the class with Nest's DI container so its dependencies resolve normally. The constructor parameters are injected just like any `@Injectable()` class. The function still returns a fresh `Type<CanActivate>` each time, parameterized by `minRole`.

Usage:
```ts
@UseGuards(MinRoleGuard('admin'))
@Get('admin')
admin() {}

@UseGuards(MinRoleGuard('editor'))
@Get('content')
content() {}
```

Each `@UseGuards` call gets its own class with its own captured `minRole`, but they all share the same DI graph.

## When this pattern applies

- Parameterized **Guards** that need DI (most common use case).
- Parameterized **Interceptors** that need DI — e.g., a `CacheInterceptor(ttl, namespace)` that injects a cache client.
- Parameterized **Pipes** (rare; usually a regular pipe with config injected via `@Inject(TOKEN)` is enough).

## When this pattern does NOT apply

- **Unparameterized Guard** → just register the class:
  ```ts
  @Injectable()
  export class PermissionsGuard implements CanActivate { ... }
  // Use directly:
  @UseGuards(PermissionsGuard)
  ```
- **Parameterization via metadata decorator** → `@RequirePermissions('verb:resource')` + `Reflector.get(...)` inside an unparameterized guard is usually cleaner than `mixin()`. This is the pattern used by `PermissionsGuard` in this repo.
- **Parameterizing services** → that's a config provider concern, not a mixin concern. Use `useFactory` (see [factory-providers.md](factory-providers.md)).

## When metadata is the better choice (this repo's existing pattern)

Look at `src/shared/guards/permissions.guard.ts` + `src/shared/decorators/permissions.decorator.ts`. The pattern is:

```ts
// Decorator stores metadata
export const RequirePermissions = (...perms: string[]) =>
  SetMetadata(PERMISSIONS_KEY, perms)

// Guard reads metadata via Reflector
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly roleService: RoleService) {}
  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.get<string[]>(PERMISSIONS_KEY, ctx.getHandler())
    // ...
  }
}

// Usage
@UseGuards(PermissionsGuard)
@RequirePermissions('read:project')
@Get(':id')
findOne() {}
```

This is **simpler than mixin()** when the guard is registered once and parameterized per route. Use mixin only when you need *runtime* values (not metadata) at usage time, or when you want the guard parameter to be visibly local to the route declaration.

## Decision: mixin vs metadata

| Need | Use |
|---|---|
| Same guard, route-specific data declared at the route | **Metadata + Reflector** (this repo's pattern) |
| Guard takes a runtime value (computed, env-derived, dynamic) | **`mixin()`** |
| Multiple parameterizations of same guard with DI | **`mixin()`** |
| One-off, no DI needed | Plain factory returning anonymous class |

## Common LLM mistakes (catch these in `code-reviewer`)

1. **Naive factory returning anonymous class** without `mixin()` — class works but loses DI. Inner class is forced to inline what should be in services.

2. **Forgetting `@Injectable()`** on the inner class. `mixin()` doesn't add it for you. Without `@Injectable()`, DI may resolve oddly.

3. **Reaching for `mixin()` when metadata would do** — over-engineering. If the guard is `@UseGuards(MyGuard)` and routes mark requirements via decorators, you're in metadata territory.

4. **Parameterizing services with `mixin()`** — services are providers; configure them via the module's `useFactory:`, not via mixin. Mixin is for cross-cutting layer classes (guards/interceptors/pipes).

5. **Returning the same `mixin()` reference twice for different params** — `mixin()` returns a fresh class each call. If you cache the result of `MinRoleGuard('admin')` and reuse, you get one DI instance shared across routes — usually fine, but be aware.

## Cross-references

- [cross-cutting.md](cross-cutting.md) — guards/interceptors/pipes/middleware decision tree.
- `repo-conventions` § "RBAC scope contract" — how the existing `PermissionsGuard` uses metadata-based parameterization.
- `nestjs-best-practices` § DI rules.
