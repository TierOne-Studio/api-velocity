---
name: repo-conventions
description: Use ALWAYS when implementing, reviewing, or refactoring executable code in this repository (api-velocity); pair with tdd-workflow. Documents conventions specific to this codebase: NestJS module layout, raw-SQL repository pattern, RBAC scope contract, projects/chat data-source model, error handling, logging, DTO style, naming. NOT for non-code work, generic NestJS questions (use nestjs-best-practices instead), or read-only investigations.
---

# Repo Conventions — api-velocity

The conventions a senior engineer joining this codebase needs in their head. Pair this skill with `tdd-workflow` and `design-review` on any code change. Diverge from these only with explicit reason and explicit user approval.

## 1. Stack at a glance

- **Framework:** NestJS 10
- **Database:** Postgres via a custom **`DatabaseService`** (raw SQL, parameterized queries) — **NOT TypeORM ORM**, despite `typeorm` being in dependencies. Do not use `@InjectRepository` or entity classes.
- **Tests:** Jest with `ts-jest`. **NOT Vitest.** Config is in `package.json` (`jest` key); E2E config at [test/jest-e2e.json](test/jest-e2e.json).
- **Auth:** session-based (Better Auth); `session` is attached to the request by middleware and read via helpers like `getActiveOrganizationId(session)`.
- **Frontend:** React (separate, not addressed in this skill).

## 2. Module layout (per domain)

Domain modules live under `src/modules/<domain>/` with this clean-architecture-style split:

```
src/modules/<domain>/
├── api/
│   ├── controllers/<domain>.controller.ts
│   └── dto/<entity>.dto.ts            ← TypeScript types only, NO class-validator
├── application/
│   ├── services/<domain>.service.ts
│   └── providers/<thing>.provider.ts  ← optional pluggable strategies
├── domain/
│   └── repositories/<domain>.repository.interface.ts
├── infrastructure/
│   └── persistence/repositories/<domain>.database-repository.ts
├── <domain>.module.ts
└── <domain>.migration.ts              ← optional, OnModuleInit-driven
```

Cross-cutting code lives in `src/shared/`:
- `config/` — `ConfigService` for env vars.
- `decorators/` — `@RequirePermissions`, `@Roles`, `@OrgRoles`.
- `guards/` — `PermissionsGuard`, `RolesGuard`, `OrgRoleGuard`.
- `infrastructure/database/` — `DatabaseService` with `query<T>()`.
- `email/` — `EmailService` (Resend SDK).
- `utils/` — `password-policy.ts`, `html-escape.ts`, `admin.utils.ts`, `org-scope.utils.ts`.

## 3. RBAC scope contract (load-bearing)

### Decorator + guard

- **Decorator:** `@RequirePermissions('verb:resource', ...)` from [permissions.decorator.ts](src/shared/decorators/permissions.decorator.ts).
- **Guard:** `PermissionsGuard` at [permissions.guard.ts](src/shared/guards/permissions.guard.ts).
- Guard resolves `effectiveRole` from session + org membership, then maps role → permissions via `RoleService.getUserPermissions()`.

### Scope resolution

`resolveOrgScope()` in [org-scope.utils.ts](src/modules/admin/users/utils/org-scope.utils.ts) returns one of:

- `{ mode: 'all' }` — cross-org access. Allowed only when the user is superadmin AND the request explicitly opts into it (e.g., `?scope=all`). Throws **400 BadRequestException** for other roles.
- `{ mode: 'single', organizationId }` — single-org access. Defaults to `activeOrganizationId` from the session if no explicit `organizationId` query param. Throws **403 ForbiddenException** if neither is available.

### Error mapping for scope/permission failures

| Failure | HTTP code | Exception |
|---|---|---|
| User lacks the required permission | 403 | `ForbiddenException` |
| User pending / rejected approval | 403 | `ForbiddenException` |
| `scope=all` requested by non-superadmin | 400 | `BadRequestException` |
| Org context missing entirely | 403 | `ForbiddenException` |

NEVER return 404 to hide a permission failure — the codebase chose 403 deliberately so leakage attempts surface in logs.

### When you write a new controller route

1. Add `@RequirePermissions('verb:resource')` to the route handler. No exceptions for "internal" routes.
2. In the service/repository, scope every query by `organizationId` derived from the resolved scope.
3. Add a test that asserts a user from a different org gets 403 (for `scope=org` resources).

## 4. Repository pattern (raw SQL, not TypeORM)

### Interface + implementation

Each domain defines an interface in `domain/repositories/`:

```ts
// src/modules/projects/domain/repositories/projects.repository.interface.ts
export interface IProjectsRepository {
  findById(id: string, organizationId: string): Promise<ProjectDetail | null>;
  // ...
}
```

The implementation lives in `infrastructure/persistence/repositories/`:

```ts
// src/modules/projects/infrastructure/persistence/repositories/projects.database-repository.ts
@Injectable()
export class ProjectsDatabaseRepository implements IProjectsRepository {
  constructor(private readonly db: DatabaseService) {}

  async findById(id: string, organizationId: string) {
    const rows = await this.db.query<ProjectRow>(
      `SELECT * FROM projects WHERE id = $1 AND organization_id = $2`,
      [id, organizationId],
    );
    return rows[0] ?? null;
  }
}
```

### Rules

- **Always parameterize.** No string interpolation into SQL. Ever.
- **Always include `organization_id` in the WHERE clause** for org-scoped tables, even if the route is guarded. Defense in depth.
- **Use the interface in service code**, not the concrete class — wire via `useClass:` in the module's providers.
- **No base repository class.** Each repo implements its own interface.
- **No raw `EntityManager`** unless transactions are required (and then use `DatabaseService` transaction helpers).

### Migrations

Custom tracked migrations, run via `OnModuleInit`:

```ts
// src/modules/<domain>/<domain>.migration.ts
@Injectable()
export class <Domain>MigrationService implements OnModuleInit {
  async onModuleInit() {
    if (await this.db.hasMigrationRun('migration-id')) return;
    await this.db.query(`CREATE TABLE ...`);
    await this.db.recordMigration('migration-id');
  }
}
```

**Caveat:** `app.module.ts` imports modules in a load-bearing order — `ProjectsModule` must come before `ChatModule` because chat depends on projects' tables existing. If you add a new module with migrations, check the import order.

## 5. Projects + multi-source chat agent

### Entity model

A **project** has 1..N **data sources**. The data source is a discriminated union:

```ts
type ProjectDataSource =
  | { kind: 'airweave_collection', config: AirweaveConfig, status, ... }
  | { kind: 'database',            config: DatabaseConfig, status, ... }
  | { kind: 'external',            config: ExternalConfig, status, ... }
```

Defined in [project.dto.ts](src/modules/projects/api/dto/project.dto.ts).

Status values: `connecting`, `ready`, `error`. **The chat agent only consumes sources with `status === 'ready'`.**

### Provider registry

Sources are dispatched to providers via `DataSourceRegistry` ([data-source.registry.ts](src/modules/projects/application/providers/data-source.registry.ts)). To add a new source kind:

1. Define the discriminated union variant in `project.dto.ts`.
2. Implement the provider class with a `search(source, query)` method.
3. Register it in the registry by `kind`.
4. Update the DB migration (or add a new one) for any schema needs.

### Chat agent

`ChatAgentService` at [chat-agent.service.ts](src/modules/chat/application/services/chat-agent.service.ts):

- Reads the project's data sources, filters to `ready`.
- Calls `registry.search(source, query)` for each.
- Injects results into the Claude API prompt as tool context.
- Returns the Claude response.

Cross-project chat is forbidden — the org-scoped repository ensures project access doesn't leak between orgs.

## 6. Error handling

### Use NestJS built-in exceptions

There is **no custom `AppError` class** and **no global exception filter**. Standard pattern:

```ts
if (!user) throw new NotFoundException('User not found');
if (user.organizationId !== orgId) throw new ForbiddenException('Cross-org access denied');
if (!isValid(input)) throw new BadRequestException('Invalid input');
```

NestJS auto-maps these to the right HTTP code.

### Anti-pattern: don't throw plain `Error` from a service

Plain `throw new Error(...)` becomes a 500 with no useful context. Use the typed exceptions.

### Bootstrap-time errors

Plain `throw new Error(...)` is fine in `ConfigService`, app bootstrap, or anywhere outside the request lifecycle.

## 7. Logger

NestJS's built-in `Logger`, one instance per class:

```ts
@Injectable()
export class MyService {
  private readonly logger = new Logger(MyService.name);

  doIt() {
    this.logger.log('starting...');
    this.logger.warn('something off');
    this.logger.error('failed', error.stack);
  }
}
```

### What's NOT in place today

- No pino / winston / structured logger.
- No request-id / correlation-id middleware.
- No automatic redaction of sensitive fields.

If you log sensitive data (PII, secrets, tokens), you are leaking it. Manually redact before logging, or just don't log it.

## 8. DTOs and validation

DTOs are **TypeScript types**, not classes:

```ts
// src/modules/projects/api/dto/project.dto.ts
export interface CreateProjectInput {
  name: string;
  description?: string;
  // ...
}
```

There is **no class-validator** decorator usage. **There is no runtime validation** of incoming request bodies — controllers trust the type signature.

This is a known weakness. When you add a new endpoint:

- Use `interface` (or `type`) for inputs, NOT `class`.
- Do basic shape checks manually if the input is user-controlled (e.g., `if (!input?.name) throw new BadRequestException('name required')`).
- Separate request types from response types (e.g., `CreateProjectInput` vs `ProjectSummary`/`ProjectDetail`).

## 9. Tests

### Tooling

Jest, configured in `package.json` (`jest` key). E2E uses [test/jest-e2e.json](test/jest-e2e.json).

### Naming

- Unit: `<thing>.spec.ts`, **co-located** next to source (e.g., `projects.controller.spec.ts` next to `projects.controller.ts`).
- E2E: `<thing>.e2e-spec.ts`, all in `/test/`.

### Setup

`test/setup.ts`, `test/teardown.ts`, `test/test-helpers.ts` — referenced from the Jest config in `package.json`.

## 10. Naming conventions

### Class suffixes

| Suffix | Used for |
|---|---|
| `Service` | Application services (business logic) |
| `Controller` | HTTP route handlers |
| `Module` | NestJS modules |
| `Provider` | Pluggable strategies (e.g., `AirweaveCollectionProvider`) |
| `Repository` | Domain repositories — implementation suffix is `DatabaseRepository` |
| `Guard` | Auth/permission guards |
| `MigrationService` | OnModuleInit migrations |

### File names

kebab-case with explicit suffixes: `projects.controller.ts`, `chat-agent.service.ts`, `org-scope.utils.ts`.

### Symbol names

PascalCase classes, camelCase functions/variables. Avoid `Manager`/`Helper`/`Util` as primary suffixes — they signal fuzzy responsibility (see `design-review` anti-patterns).

## 11. Repo-specific anti-patterns

### Module-import-order coupling

`app.module.ts` has comments noting that `ProjectsModule` MUST be imported before `ChatModule` due to migration sequencing. Don't reorder casually. If you add a module with migrations, check the order and add a comment.

### Raw SQL without parameterization

The codebase uses raw SQL throughout. Always use `$1, $2, ...` placeholders and pass values as the second argument to `db.query`. NEVER concatenate user input.

### Cross-org leakage via missing `organization_id`

Easy to forget when writing a new query. The query-level scoping is the second line of defense (after the route guard). Check every `WHERE` clause when reviewing repository changes.

### Skipping the test for the negative case

Routes need both a positive test (authorized user gets 200) AND a negative test (different-org user gets 403). The negative test is what catches RBAC regressions.

### Logging PII

Because there's no automatic redaction, every `logger.log` call is a potential leak point. Don't log request bodies, don't log user objects, don't log session tokens.

## 12. When to deviate from these conventions

You may diverge if:

- The conventions themselves are the bug being fixed (e.g., adding class-validator across the codebase as a deliberate refactor).
- A user explicitly requests a different approach.
- An external library forces a different shape.

In all cases: state the deviation explicitly in the response, name the reason, and propose updating this skill in the same change (so the convention set stays current).

NEVER deviate silently.
