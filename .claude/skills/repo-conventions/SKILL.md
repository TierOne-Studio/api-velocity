---
name: repo-conventions
description: Use ALWAYS when implementing, reviewing, or refactoring executable code in this repository (api-velocity); pair with tdd-workflow. ALSO use when discussing api-velocity's architecture, RBAC, error handling, persistence, logger conventions, DTO style, or any repo-specific decision — even on non-code turns (the skill primes the model on the binding conventions and ADR-mapped surfaces that CLAUDE.md no longer enumerates). Documents conventions specific to this codebase: NestJS module layout, TypeORM-first repository pattern (with raw-SQL fallback criteria), RBAC scope contract, projects/chat data-source model, error handling, logging, DTO style, naming. NOT for generic NestJS questions (use nestjs-best-practices instead) or read-only investigations of unrelated codebases.
---

# Repo Conventions — api-velocity

The conventions a senior engineer joining this codebase needs in their head. Pair this skill with `tdd-workflow` and `design-review` on any code change. Diverge from these only with explicit reason and explicit user approval.

## ADR-backed conventions (the *why* lives in `docs/decisions/`)

Several conventions in this skill are load-bearing — changing them requires a structural decision, not a routine commit. Those conventions cite ADRs rather than restate rationale inline:

| Convention | ADR | Where in this skill |
|---|---|---|
| TypeORM-first persistence (raw-SQL fallback) | [ADR-001](../../../docs/decisions/ADR-001-typeorm-first-persistence.md) | § 1, § 4 |
| RBAC `scope=all` returns 400 (not 403) | [ADR-002](../../../docs/decisions/ADR-002-rbac-scope-all-returns-400.md) | § 3 |
| No global exception filter — throw NestJS built-ins | [ADR-003](../../../docs/decisions/ADR-003-no-global-exception-filter.md) | § 6 |
| NestJS Logger (no pino, no structured logging, no request-id) | [ADR-004](../../../docs/decisions/ADR-004-nestjs-logger-no-pino.md) | § 7 |
| No `class-validator` / no global `ValidationPipe` | [ADR-005](../../../docs/decisions/ADR-005-no-class-validator-no-validation-pipe.md) | § 8 |
| Clean architecture / hexagonal layering for new modules (4-layer split + dependency rule) | [ADR-009](../../../docs/decisions/ADR-009-clean-architecture-layering-for-modules.md) | § 2, § 4 |

If you're about to add a paragraph explaining *why* one of these conventions exists, stop — that paragraph belongs in the ADR. This skill captures *how to follow the convention today*; the ADR captures *why this is the rule and what was rejected*. See `documentation-and-adrs` for the full discipline.

## 0. Domain glossary — terms used throughout the codebase

Anchor terms a contributor needs in their head before touching feature code. Use these terms exactly in code, tests, commits, ADRs, and PR descriptions — drift produces ambiguity that surfaces as bugs ("user vs account vs member"). Add a term here when a new concept becomes load-bearing across modules.

| Term | Definition |
|---|---|
| **Organization** (`organization_id`) | Tenant boundary. Every business entity belongs to exactly one organization unless explicitly cross-org. The unit of RBAC scoping. |
| **User** | Authenticated identity. A user can belong to multiple organizations via membership records, but each request runs in the context of ONE active organization. |
| **Active organization** (`activeOrganizationId`) | The org the current request is operating within. Default scope for `scope=single` queries. Resolved by `resolveOrgScope()`. |
| **Superadmin** | A role-level flag (`req.user.isSuperadmin`) that authorizes `scope=all` cross-org queries. Distinct from any organization-level admin role. |
| **Permission** | A `verb:resource` string (e.g., `read:users`, `delete:projects`) attached to a route via `@RequirePermissions(...)`. Mapped to roles in `RoleService.getUserPermissions()`. |
| **Role** | A named bundle of permissions. Per-organization (a user can have role X in org A and role Y in org B). |
| **Scope** | Query-level cross-org control. `scope=single` (default) → operate within `activeOrganizationId`. `scope=all` → operate cross-org (superadmin only — non-superadmin gets 400, see `ADR-002`). |
| **Project** | A container for content + chat data sources. Belongs to one organization. The unit users author against. |
| **Source** | A data input attached to a project (file upload, URL, database connection, etc.). Each has a readiness state; the chat agent only consults ready sources. |
| **Agent** | The chat orchestrator that answers user questions over a project's ready sources. Distinct from "the AI agent writing this code" — when ambiguous, say "chat agent" or "code agent". |
| **DTO** | Plain TypeScript request/response type. **No** `class-validator` decorators (see `ADR-005`). |
| **Repository** | TypeORM-backed data-access class for new modules (see `ADR-001`). Existing raw-SQL repositories are NOT renamed. |

Terms NOT in this glossary are not load-bearing — for module-local concepts, name them in the module's own README or in the ADR that introduced them.

## 1. Stack at a glance

- **Framework:** NestJS 11 (see `package.json` for exact versions)
- **Database:** Postgres. **Hybrid persistence (TypeORM-first for new modules):**
  - **Default for new modules: TypeORM** (`@nestjs/typeorm` with `@InjectRepository` and entity classes — see [role.typeorm-repository.ts](src/modules/admin/rbac/infrastructure/persistence/repositories/role.typeorm-repository.ts) for the canonical example).
  - **Drop to raw SQL via `DatabaseService`** only with explicit justification (criteria in § 4).
  - **Existing raw-SQL modules** (projects, chat, admin/users, etc.) are NOT flagged for migration. The convention is forward-looking. When making significant changes to an existing raw-SQL module, evaluate whether the scope is large enough to migrate to TypeORM at the same time — but routine maintenance does not require migration.
- **Tests:** Jest with `ts-jest`. **NOT Vitest.** Config is in `package.json` (`jest` key); E2E config at [test/jest-e2e.json](test/jest-e2e.json).
- **Auth:** session-based (Better Auth); `session` is attached to the request by middleware and read via helpers like `getActiveOrganizationId(session)`.
- **Frontend:** React (separate, not addressed in this skill).

## 2. Module layout (per domain)

Domain modules live under `src/modules/<domain>/` with the clean-architecture / hexagonal split codified in [`ADR-009`](../../../docs/decisions/ADR-009-clean-architecture-layering-for-modules.md). For the full pattern (domain entity, repository port, TypeORM adapter, application service, controller wiring, dependency rule, anti-patterns), see the **`nestjs-clean-architecture`** skill — fires when designing or reviewing a new module. This section gives the layout summary; the skill gives the implementation patterns.

The 4-layer split:

```
src/modules/<domain>/
├── api/
│   ├── controllers/<domain>.controller.ts
│   └── dto/<entity>.dto.ts            ← Request/response shapes (types or classes), no class-validator / ValidationPipe
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

## 4. Repository pattern (TypeORM-first for new modules)

**Two patterns coexist in this repo.** TypeORM is the default for new modules. Raw SQL via `DatabaseService` is the **fallback** when TypeORM can't satisfy a specific requirement. Existing raw-SQL modules (projects, chat, admin/users, etc.) are NOT flagged for migration — the convention is forward-looking.

### Default: TypeORM (canonical example: RBAC)

Define a domain interface in `domain/repositories/`, then implement with TypeORM in `infrastructure/persistence/repositories/`. Define entity classes alongside in `infrastructure/persistence/entities/`.

```ts
// src/modules/admin/rbac/domain/repositories/role.repository.interface.ts
export interface IRoleRepository {
  findById(id: string, organizationId: string): Promise<Role | null>;
  // ...
}
```

```ts
// src/modules/admin/rbac/infrastructure/persistence/repositories/role.typeorm-repository.ts
@Injectable()
export class RoleTypeOrmRepository implements IRoleRepository {
  constructor(
    @InjectRepository(RoleTypeOrmEntity)
    private readonly roleRepo: Repository<RoleTypeOrmEntity>,
  ) {}

  async findById(id: string, organizationId: string): Promise<Role | null> {
    const entity = await this.roleRepo.findOne({
      where: { id, organizationId },
    });
    return entity ? toDomain(entity) : null;
  }
}
```

Module wiring:

```ts
@Module({
  imports: [TypeOrmModule.forFeature([RoleTypeOrmEntity, PermissionTypeOrmEntity])],
  providers: [{ provide: 'IRoleRepository', useClass: RoleTypeOrmRepository }],
})
export class RbacModule {}
```

### TypeORM rules

- **Always include `where: { organizationId }`** for org-scoped queries, even when the route is scope-guarded. Defense in depth.
- **Use the interface in service code**, not the concrete class — wire via `useClass:` in the module's providers.
- **No base repository class.** Each repo implements its own interface.
- **Define entity classes** in `infrastructure/persistence/entities/` with `@Entity()` and `@Column()` decorators.
- **For multi-statement work**, use TypeORM's `manager.transaction(...)` (see `database-transactions` skill).
- **Map at the boundary** — entities (DB shape) and domain objects (service shape) are not the same type. Convert in the repository.

### When to drop to raw SQL (the fallback)

State the reason in a code comment when you fall back. Valid reasons:

1. **TypeORM can't express the query.** Window functions, recursive CTEs, complex JSON operations (`jsonb_path_query`, `jsonb_set`), full-text search (`tsvector`), `LATERAL` joins, custom aggregates.
2. **Measured performance issue.** TypeORM's QueryBuilder generates pathological SQL for the specific case — verify with `EXPLAIN ANALYZE`, not assume.
3. **Material auditability or safety win.** A complex query with subtle correctness requirements (security, financial calculations) is genuinely more reviewable as parameterized raw SQL than as ORM-builder code.
4. **Bulk operations** where the ORM's per-row overhead is the bottleneck (measured, not assumed).
5. **Schema migrations** that need fine DDL control beyond what TypeORM migrations expose.

If none of those apply, use TypeORM.

### Fallback: raw SQL via DatabaseService

Same domain interface; different implementation:

```ts
// Established pattern in existing modules — projects, chat, admin/users
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

### Raw-SQL rules

- **Always parameterize.** No string interpolation into SQL. Ever.
- **Always include `WHERE organization_id = $N`** for org-scoped tables. Same defense-in-depth principle as TypeORM.
- **Use the interface in service code**, not the concrete class.
- **No base repository class.**
- **For multi-statement work**, use `DatabaseService.transaction<T>(callback)` (see `database-transactions` skill).
- **Add a comment** explaining why TypeORM wasn't viable for this query (cite the specific reason from the criteria above).

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

### Use NestJS built-in exceptions (preferred direction)

There is **no custom `AppError` class** and **no global exception filter**. Standard pattern for new code:

```ts
if (!user) throw new NotFoundException('User not found');
if (user.organizationId !== orgId) throw new ForbiddenException('Cross-org access denied');
if (!isValid(input)) throw new BadRequestException('Invalid input');
```

NestJS auto-maps these to the right HTTP code.

### Reality check: existing code is not fully aligned

Several existing services and repositories throw plain `Error(...)`:

- `chat.database-repository.ts` — "Failed to create conversation", "Failed to create message"
- `chat-agent.service.ts` — "Agent produced no assistant content"
- `airweave-collection.provider.ts`
- `admin-user.database-repository.ts`
- `verification.utils.ts`

These are pre-existing. **Don't grandfather them as the convention.** When you touch one of these files, prefer migrating to a NestJS exception. When you write new code, use NestJS exceptions from the start. A plain `Error` from a service becomes a 500 with no useful context — that's a regression for any HTTP-facing flow.

### Bootstrap-time errors

Plain `throw new Error(...)` is fine in `ConfigService`, app bootstrap, or anywhere outside the request lifecycle.

## 7. Logger

**Preferred direction: NestJS's built-in `Logger`, one instance per class** (existing code is mixed; see "Reality check" below):

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

### Reality check: existing code mixes `Logger` with `console.*`

Several files use `console.log` / `console.warn` / `console.error` in non-bootstrap code:

- `chat-agent.service.ts` — multiple `console.error`/`console.warn` calls
- `chat-agent-tools.ts` — `console.warn`
- `airweave.service.ts` — `console.error`
- Migration files (`chat.migration.ts`, `projects.migration.ts`) — `console.log`/`console.warn` for migration progress (these are bootstrap-time; acceptable)

**For new code: use the NestJS `Logger` per class.** When you touch existing `console.*` calls in non-bootstrap code, migrate them to the class's `Logger`. Migration scripts using `console.log` for progress output are fine to leave alone.

### What's NOT in place today

- No pino / winston / structured logger.
- No request-id / correlation-id middleware.
- No automatic redaction of sensitive fields.

If you log sensitive data (PII, secrets, tokens), you are leaking it. Manually redact before logging, or just don't log it.

### Log-level discipline

| Level | When | Example |
|---|---|---|
| `debug` | Dev-time only; verbose flow tracing | `logger.debug('resolved scope', { mode: scope.mode })` |
| `log` (info) | Normal-flow milestones worth keeping in prod | `logger.log('project created', { projectId, organizationId })` |
| `warn` | Degraded but recoverable; partial failure; deprecated-path use | `logger.warn('source timed out, continuing with remaining sources', { sourceId })` |
| `error` | Exception about to propagate or something genuinely failed | `logger.error('migration failed', error.stack)` |

Anti-pattern: logging at `error` for things that aren't errors. Drowns alerts. If it's expected (e.g., user supplied invalid input), it's `warn` at most.

### What to log (context fields)

Always include enough context to debug from the log alone:

- **Identifiers** — entity IDs (`projectId`, `userId`, `organizationId`).
- **Operation name** — what was being attempted (`'project.create'`, `'chat.search'`).
- **Outcome** — success/failure markers, counts, durations where relevant.
- **Caller scope** — which org / role context the operation ran under.

```ts
this.logger.log('project created', {
  projectId: project.id,
  organizationId: scope.organizationId,
  sourceCount: input.sources.length,
})
```

### What NEVER to log

- **Passwords**, password hashes, password reset tokens.
- **Session tokens**, JWT bearer tokens, API keys.
- **Email bodies**, SMS bodies (PII + content).
- **Billing data** — card numbers, CVVs, full IBANs.
- **Request bodies** wholesale (they may contain any of the above). Log specific fields, not the whole object.
- **`session` objects** — they often contain user PII; extract just `userId` and `organizationId`.

### Manual redaction patterns

When you genuinely need to log a structure that may contain sensitive fields, redact at the call site (no middleware does it for you):

```ts
const redacted = {
  ...input,
  password: input.password ? '[REDACTED]' : undefined,
  token: input.token ? '[REDACTED]' : undefined,
}
this.logger.log('login attempt', { email: redacted.email })  // not even redacted, just don't log it
```

A helper `redact(obj, fields)` in `src/shared/utils/` would be a reasonable addition; today there isn't one.

### Correlation in the absence of request-id middleware

Since this repo has no request-id middleware, you cannot correlate logs across services in the usual way. What to do:

- **Within a single request**: log the same set of identifiers (`userId`, `organizationId`, `projectId`) on every log line in the call chain. Reconstruct the trace from those.
- **Across requests**: you cannot, today. If correlation across requests becomes a real need, add request-id middleware (its own change with its own design review).
- **Don't fake it** by generating an ID at log time that has no relationship to anything else — it just adds noise.

### Audit logging vs operational logging

- **Operational logs** — for engineers, ephemeral, debug/info/warn/error. The `Logger` covers this.
- **Audit logs** — for compliance, durable, security-relevant events (permission grants, scope=all access, role changes). These belong in a separate table or a dedicated audit destination, **not** mixed into the operational logger. This codebase doesn't have a dedicated audit log today; if a feature needs one, design it as a new table + service rather than relying on grepping `error.log`.

## 8. DTOs and validation

DTOs are **either TypeScript types or classes** — both patterns coexist:

- **Types/interfaces** (most common): `src/modules/projects/api/dto/project.dto.ts` exports interfaces.
  ```ts
  export interface CreateProjectInput {
    name: string;
    description?: string;
  }
  ```
- **Classes** (used in `admin/rbac/api/dto/`, `admin/organizations/api/dto/`): exported as plain class declarations without `class-validator` decorators.

**There is no `class-validator` decorator usage and no centralized `ValidationPipe`.** Runtime validation, when present, is done **manually** in controllers and services rather than auto-enforced by Nest.

When you add a new endpoint:

- Prefer `interface` or `type` for inputs unless an existing pattern in the same module uses classes.
- Perform manual runtime validation for user-controlled input:
  ```ts
  if (!input?.name) throw new BadRequestException('name required');
  ```
- Separate request shapes from response shapes (e.g., `CreateProjectInput` vs `ProjectSummary`/`ProjectDetail`).

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
