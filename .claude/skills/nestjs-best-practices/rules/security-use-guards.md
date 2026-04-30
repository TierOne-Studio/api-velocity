---
title: Use Guards for Authentication and Authorization
impact: HIGH
impactDescription: Enforces access control before handlers execute
tags: security, guards, authentication, authorization
---

## Use Guards for Authentication and Authorization

Guards determine whether a request should be handled based on authentication state, roles, permissions, or other conditions. They run after middleware but before pipes and interceptors, making them ideal for access control. Use guards instead of manual checks in controllers.

> ⚠️ **Skill-vs-repo conflict resolution (per `CLAUDE.md` P3.5):** This rule's "registered globally via `APP_GUARD`" pattern is a **structural choice**. **The current api-velocity repo does NOT use `APP_GUARD` anywhere** — guards are applied per-controller / per-route via `@UseGuards(...)` plus metadata decorators (`@RequirePermissions(...)`, `PermissionsGuard`). Switching to `APP_GUARD` registration is an app-wide bootstrap change.
>
> **Default for the current PR:** follow `repo-conventions` (Approach A below). Use route-level `@UseGuards(...)`. Do not introduce `APP_GUARD` as a side-effect of unrelated work.
>
> **If the change is explicitly about adopting global guard registration**, that's a deliberate structural decision — switch to Approach B and ASK the user first.

## Outcome

- Authentication and authorization are enforced **before** handler execution, not via manual `if (!req.user)` checks inside controllers.
- A single source of truth controls access for each route (decorator + guard).
- Failed auth produces correct HTTP semantics (401 for unauthenticated, 403 for forbidden, 400 for `scope=all` by non-superadmin per repo's RBAC contract).
- The guard layer is testable in isolation.

## Approach gate (ASK FIRST)

> Before writing any code, ASK the user:
>
> > "This change involves authentication/authorization guards. The api-velocity repo currently applies guards **per-route** via `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('verb:resource')` (no `APP_GUARD` anywhere — see [src/modules/admin/users/users.controller.ts](src/modules/admin/users/users.controller.ts) for the canonical pattern).
> >
> > Options:
> > - **(A) Route-level `@UseGuards`** — match the existing repo convention. Surgical, no bootstrap changes.
> > - **(B) Global `APP_GUARD` registration** — structural refactor: every existing route's guard wiring is affected; needs regression coverage. Recommended only if this PR is explicitly about adopting global guard registration.
> >
> > Which approach?"
>
> Wait for explicit response. Default to (A) unless the user says (B).

## Approach A — Route-level `@UseGuards` (current repo convention, surgical)

This is the established pattern across api-velocity. The `JwtAuthGuard` runs for authentication; `PermissionsGuard` reads `@RequirePermissions(...)` metadata and applies the project's RBAC scope contract.

**Anti-pattern (manual auth checks in every handler):**

```typescript
@Controller('admin')
export class AdminController {
  @Get('users')
  async getUsers(@Request() req) {
    if (!req.user) throw new UnauthorizedException();
    if (!req.user.roles.includes('admin')) throw new ForbiddenException();
    return this.adminService.getUsers();
  }
}
```

**Correct (declarative guards at the route, repo-fit):**

```typescript
import { Controller, Get, Delete, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/shared/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/shared/guards/permissions.guard';
import { RequirePermissions } from 'src/shared/decorators/permissions.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)  // applied to every route in this controller
export class AdminController {
  @Get('users')
  @RequirePermissions('read:users')
  getUsers(): Promise<User[]> {
    return this.adminService.getUsers();
  }

  @Delete('users/:id')
  @RequirePermissions('delete:users')
  deleteUser(@Param('id') id: string): Promise<void> {
    return this.adminService.deleteUser(id);
  }
}
```

The `PermissionsGuard` (see [src/shared/guards/permissions.guard.ts](src/shared/guards/permissions.guard.ts)) maps `@RequirePermissions(...)` metadata onto the user's role-permission set, applies `resolveOrgScope()` for tenant isolation, and throws `ForbiddenException` (403) on mismatch or `BadRequestException` (400) for `scope=all` by non-superadmin. This contract is documented in `repo-conventions` § "RBAC scope contract".

**For a public route** within an otherwise-guarded controller, use route-level override:

```typescript
@Get('health')
@UseGuards()  // override: no guards
health() { return { status: 'ok' }; }
```

(There is no `@Public()` decorator in the current repo. If you find yourself wanting one across many controllers, that's a signal for Approach B — surface it for user discussion.)

## Approach B — Global `APP_GUARD` registration ⚠️ Structural refactor — adoption-gated

> ⚠️ **This is an app-wide bootstrap change.** Adding `APP_GUARD` providers means **every existing route is now subject to the guard chain by default**, and the existing per-route `@UseGuards(...)` annotations become redundant or conflicting. This is NOT a per-PR tweak — it's a structural decision affecting the entire route table.
>
> **Before implementing, ASK the user** with the Approach gate above. Default to (A) unless the user says (B).

If adopted, the implementation:

```typescript
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService, private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('No token provided');

    try {
      request.user = await this.jwtService.verifyAsync(token);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private extractToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}

export const Public = () => SetMetadata('isPublic', true);

@Module({
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
```

**Adoption checklist (when the user approves Approach B):**

1. Audit every existing controller — confirm `@UseGuards(JwtAuthGuard, PermissionsGuard)` is removed (or kept only where the global chain needs *additional* guards).
2. Add `@Public()` decorators to currently-unauthenticated routes (health, public webhooks, anything inside `auth/`) — failing this step locks out legitimate traffic.
3. Add a regression test asserting: a route with no decorator AND no `@Public()` returns 401 / 403 (i.e., the global guard is actually firing).
4. Update `CLAUDE.md` P2 + `repo-conventions` § "RBAC scope contract" to reflect the new convention.
5. The PR description must call out the structural change (this is no longer "wire a new route" — it's "change app-wide guard semantics").
6. **Write `docs/decisions/ADR-NNN-app-guard-global-registration.md`** documenting context (what changed since the route-level convention), decision, alternatives, consequences. If a prior ADR captured the route-level decision, mark it as `Status: Superseded by ADR-NNN`. Update the index in `docs/decisions/README.md`. See `documentation-and-adrs`.

Reference: [NestJS Guards](https://docs.nestjs.com/guards)
