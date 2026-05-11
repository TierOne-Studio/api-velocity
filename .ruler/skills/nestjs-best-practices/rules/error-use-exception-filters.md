---
title: Use Exception Filters for Error Handling
impact: HIGH
impactDescription: Consistent, centralized error handling
tags: error-handling, exception-filters, consistency
---

## Use Exception Filters for Error Handling

Errors in HTTP endpoints get consistent, structured responses. Controllers don't manually format error JSON; they throw, and a single mechanism handles the mapping to HTTP.

> ⚠️ **Skill-vs-repo conflict resolution (per `CLAUDE.md` P3.5):** This rule recommends adding a global `AllExceptionsFilter`. **The repo currently has no global exception filter** (per `CLAUDE.md` P2 + `repo-conventions` § "Error handling"). Adding one is a **structural refactor** — it changes app-wide error mapping, affects every existing route, and isn't tied to a specific PR's scope.
>
> **Default for the current PR:** follow `repo-conventions` (Approach A below). Throw NestJS built-in exceptions; let the framework auto-map. Don't introduce a global filter as a side-effect of unrelated work.
>
> **If the change is explicitly about adopting centralized error handling**, that's a deliberate structural decision — switch to Approach B and ASK the user first.
>
> **For all other cases, recommend the global-filter adoption as a Future task** in the response's Optional Improvements section (per `CLAUDE.md` P8 item 10).

## Outcome

- Controllers do NOT manually format error responses (no `res.status().json({...})`).
- Errors are thrown as typed exceptions with appropriate HTTP semantics.
- Error responses are consistent in shape across the API.
- Stack traces / sensitive details don't leak to clients.

## Approach A — Throw NestJS built-in exceptions, no global filter (current repo, structural-no-change)

This is the repo's established pattern. Sufficient for most error cases; NestJS auto-maps the built-in exceptions to HTTP responses.

```typescript
// Use built-in exceptions; NestJS handles HTTP mapping automatically
import { Controller, Get, Param, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';

@Controller('users')
export class UsersController {
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<User> {
    const user = await this.usersService.findById(id);
    if (!user) {
      throw new NotFoundException(`User #${id} not found`);
    }
    return user;
  }
}

// Repo-specific scope check throws ForbiddenException (per repo-conventions § RBAC)
@Get(':id/admin-data')
async getAdminData(@Param('id') id: string, @Req() req): Promise<AdminData> {
  const scope = resolveOrgScope(req);
  if (scope.mode === 'all' && !req.user?.isSuperadmin) {
    throw new BadRequestException('scope=all requires superadmin');
  }
  // ... 403 ForbiddenException for cross-org access automatically via PermissionsGuard
  return this.adminService.find(id);
}
```

NestJS's default exception handling auto-maps:
- `NotFoundException` → 404 with `{ statusCode, message }`
- `ForbiddenException` → 403
- `BadRequestException` → 400
- `HttpException(message, status)` → custom status
- Anything else → 500 (uncaught — gets the default Nest error envelope)

**Anti-pattern (regardless of approach):** manual error formatting in controllers.

```typescript
// ❌ Manual error handling in controllers
@Controller('users')
export class UsersController {
  @Get(':id')
  async findOne(@Param('id') id: string, @Res() res: Response) {
    try {
      const user = await this.usersService.findById(id);
      if (!user) {
        return res.status(404).json({
          statusCode: 404,
          message: 'User not found',
        });
      }
      return res.json(user);
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        statusCode: 500,
        message: 'Internal server error',
      });
    }
  }
}
```

This is a HIGH finding regardless of which approach the repo uses — controllers should throw, not format JSON manually.

**Anti-pattern specific to this repo (per `repo-conventions` § Error handling):** plain `Error(...)` from a service.

```typescript
// ❌ Plain Error from a service becomes a 500 with no useful context
@Injectable()
export class ChatService {
  async send(input: ChatInput): Promise<Reply> {
    if (!this.canHandle(input)) {
      throw new Error('Cannot handle input'); // → 500, opaque to client
    }
    // ...
  }
}

// ✅ Use NestJS built-ins
throw new BadRequestException('Cannot handle input: missing source');
```

## Approach B — Add a global `AllExceptionsFilter` ⚠️ Structural refactor — adoption-gated

> ⚠️ **This is a structural change to the repo.** Adding a global filter affects every existing route's error response shape and is NOT scoped to a specific PR. Per `CLAUDE.md` P3.5, this should be its own deliberate task — not a side-effect of work in another module.
>
> **Before implementing**, ASK the user:
>
> > "This change would add a global `AllExceptionsFilter` to the application. The repo currently has no global filter (per `CLAUDE.md` P2). Adopting this affects error responses for ALL existing routes — it's a structural refactor that should be its own focused PR with regression testing.
> >
> > Options:
> > - **(A)** Skip the global filter for this PR. Throw NestJS built-in exceptions; flag adoption as a Future task in Optional Improvements.
> > - **(B)** This PR is explicitly about adopting centralized error handling — proceed with the filter, add it in a focused commit, ensure regression coverage.
> >
> > Which option?"
>
> Wait for explicit response. Default to (A) unless the user says (B).

If adopted, the implementation:

```typescript
// Custom domain exception (optional — built-ins usually suffice)
export class UserNotFoundException extends NotFoundException {
  constructor(userId: string) {
    super({
      statusCode: 404,
      error: 'Not Found',
      message: `User with ID "${userId}" not found`,
      code: 'USER_NOT_FOUND',
    });
  }
}

// Custom exception filter for domain errors
@Catch(DomainException)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception.getStatus?.() || 400;

    response.status(status).json({
      statusCode: status,
      code: exception.code,
      message: exception.message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}

// Global exception filter for unhandled errors
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.message
        : 'Internal server error';

    this.logger.error(
      `${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : exception,
    );

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}

// Register globally in main.ts
app.useGlobalFilters(
  new AllExceptionsFilter(app.get(Logger)),
  new DomainExceptionFilter(),
);

// Or via module
@Module({
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
```

**Adoption checklist (when the user approves Approach B):**
1. Add the filter classes in `src/shared/infrastructure/error-handling/` (new directory).
2. Register globally in `main.ts` OR via `APP_FILTER` in `AppModule`.
3. Add regression tests covering: 404 (NotFoundException), 403 (ForbiddenException), 400 (BadRequestException), 500 (uncaught Error).
4. Verify existing test suite still passes — error response shapes may have changed.
5. Update `CLAUDE.md` P2 + `repo-conventions` § Error handling to reflect the new convention.
6. **Write `docs/decisions/ADR-NNN-global-exception-filter-adoption.md`** documenting context (what changed since `ADR-003`), decision, alternatives, consequences. Mark `ADR-003` as `Status: Superseded by ADR-NNN`. Update the index in `docs/decisions/README.md`. See `documentation-and-adrs`.

Reference: [NestJS Exception Filters](https://docs.nestjs.com/exception-filters)
