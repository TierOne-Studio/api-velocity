# NestJS Dynamic Modules

A static `@Module({...})` is fine when the providers and imports are known at definition time. The moment a consumer needs to *configure* the module — pass an API key, choose a strategy, scope to a feature — you're in dynamic-module territory. This is one of the highest-leverage NestJS patterns and one the LLM gets wrong most reliably.

## When this pattern applies

- The module wraps a third-party SDK that needs a key/endpoint (Stripe, Resend, Redis, OpenAI).
- The module exposes a feature that should be configured differently per environment (logging level, retry policy, sample rate).
- The module is a feature module that's instantiated multiple times for different feature scopes (per-entity, per-domain).
- Consumers need to compose the module's setup from their own providers (e.g., supplying an HTTP client, a logger, a config source).

## When this pattern does NOT apply

- A simple feature module whose providers don't depend on consumer-supplied values → static `@Module({...})` is correct.
- A module that holds *only* its own internal services with internal config from `ConfigService` → no need to expose `forRoot`. Just import `ConfigModule` and `ConfigService` and read directly.
- One-off configuration that's actually a consumer concern → put the config in the consumer's module, not in a synthetic `forRoot` wrapper.

## The four return shapes (decision tree)

| Method | Returns | When |
|---|---|---|
| `forRoot(opts)` | `DynamicModule` | App-wide setup with sync config |
| `forRootAsync(opts)` | `DynamicModule` | App-wide setup with async/derived config |
| `forFeature(opts)` | `DynamicModule` | Per-feature slice (e.g., per-entity repo registration) |
| `register(opts)` | `DynamicModule` | Same shape as `forRoot`, but conventionally for non-singleton modules registered multiple times |

`forRoot` is for the global, single-instance setup of the module. `forFeature` is for the repeated per-domain extension. `register` is rarely needed; prefer `forRoot` unless you genuinely need multiple non-singleton instances.

## Canonical patterns

### 1. Static module (no dynamic API needed)

```ts
@Module({
  providers: [ProjectsService, ProjectsRepository],
  controllers: [ProjectsController],
  exports: [ProjectsService],
})
export class ProjectsModule {}
```

If you find yourself reaching for `forRoot()` here, ask: does the *consumer* need to configure this? If no, stop.

### 2. `forRoot` — sync config

```ts
export interface AuditModuleOptions {
  destination: 'stdout' | 'database'
  redactFields: string[]
}

@Module({})
export class AuditModule {
  static forRoot(opts: AuditModuleOptions): DynamicModule {
    return {
      module: AuditModule,
      providers: [
        { provide: 'AUDIT_OPTIONS', useValue: opts },
        AuditService,
      ],
      exports: [AuditService],
    }
  }
}

// Consumer:
@Module({
  imports: [AuditModule.forRoot({ destination: 'database', redactFields: ['password'] })],
})
export class AppModule {}
```

### 3. `forRootAsync` — async/derived config (preferred when reading from `ConfigService`)

```ts
@Module({})
export class AuditModule {
  static forRootAsync(opts: {
    useFactory: (...args: any[]) => AuditModuleOptions | Promise<AuditModuleOptions>
    inject?: any[]
    imports?: any[]
  }): DynamicModule {
    return {
      module: AuditModule,
      imports: opts.imports ?? [],
      providers: [
        { provide: 'AUDIT_OPTIONS', useFactory: opts.useFactory, inject: opts.inject ?? [] },
        AuditService,
      ],
      exports: [AuditService],
    }
  }
}

// Consumer:
@Module({
  imports: [
    AuditModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (cfg: ConfigService): AuditModuleOptions => ({
        destination: cfg.get('AUDIT_DEST') as any,
        redactFields: cfg.get<string[]>('AUDIT_REDACT') ?? [],
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

The async variant is what you almost always want when config comes from env. It plays nicely with [factory-providers.md](factory-providers.md).

### 4. `forFeature` — per-feature registration

When a module exposes a generic capability that gets registered multiple times for different domains. **This repo already uses `forFeature` in RBAC** via TypeORM:

```ts
// src/modules/admin/rbac/rbac.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([RoleTypeOrmEntity, PermissionTypeOrmEntity])],
  providers: [
    { provide: 'IRoleRepository',       useClass: RoleTypeOrmRepository },
    { provide: 'IPermissionRepository', useClass: PermissionTypeOrmRepository },
  ],
})
export class RbacModule {}
```

`TypeOrmModule.forFeature([Entity])` registers the entities scoped to *this* module — `@InjectRepository(Entity)` then resolves to that registration. New modules following the TypeORM-first convention (per `repo-conventions`) will use this pattern.

The same shape applies to any custom module that exposes a generic capability registered per-feature (e.g., a hypothetical `RateLimiterModule.forFeature({ name: 'auth-routes', limit: 5 })`). The pattern is: `forRoot` once, `forFeature` per consumer.

### 5. `@Global()` — when (rarely) and when not

```ts
@Global()
@Module({
  providers: [LoggerService],
  exports: [LoggerService],
})
export class LoggerModule {}
```

`@Global()` makes the module's exports available **everywhere without explicit import**. Sounds convenient. **It's an anti-pattern for most modules.**

**Use `@Global()` only when:**
- The module is genuinely cross-cutting AND truly used everywhere (logger, metrics).
- Adding explicit imports to every consumer would be pure noise.

**Do NOT use `@Global()` for:**
- A module used in a few places — explicit `imports: [...]` makes the dependency visible (Explicitness over Magic, per CLAUDE.md P5).
- A module whose providers should be scoped to a feature.
- A module just because "it's annoying to import."

A `@Global()` decorator is a confession that you didn't want to write `imports: [...]`. Make sure that confession is justified.

## Common LLM mistakes (catch these in `architect-reviewer` and `code-reviewer`)

1. **Wrapping every module in `forRoot()`** — over-engineering. Static modules are fine when no consumer config is needed.

2. **Using `forRoot` with sync env-reading** — works, but means env vars are read at module-load time, before `ConfigModule` may have validated them. Use `forRootAsync` with `ConfigService` injection.

3. **Forgetting to `exports:` the providers** — module compiles, consumers get "Nest can't resolve dependency" at runtime.

4. **`@Global()` on a domain module** — leaks domain providers everywhere, breaks SoC.

5. **Two `forRoot` calls register two singletons** — for a true singleton-on-app, `forRoot` should be called once. If you need per-feature, use `forFeature`.

6. **Returning the wrong `DynamicModule` shape** — forgetting `module: ClassName`, or mixing `providers` and `imports` incorrectly.

7. **Using `register()` for global-singleton modules** — by convention `register` implies multi-instance; `forRoot` implies singleton. Reversing this confuses readers even if Nest accepts both.

## Repo-fit examples

- `DatabaseModule` (`src/shared/infrastructure/database/database.module.ts`) — currently a static module exposing `DatabaseService`. If it ever needed per-tenant DB credentials, `forRootAsync` would be the move.
- `ProjectsModule` and `ChatModule` — static feature modules. The known import-order coupling (Projects must come before Chat per `repo-conventions` § "Module load order") is a structural concern; dynamic modules wouldn't change that.
- `RbacModule` — uses `TypeOrmModule.forFeature(...)` (see § 4 above).

## Cross-references

- [factory-providers.md](factory-providers.md) — what `useFactory` does inside `forRootAsync`.
- `nestjs-best-practices` — `arch-feature-modules`, `arch-module-sharing`.
- `repo-conventions` § "Module layout" — domain module structure for this repo.
- `CLAUDE.md` P5 explicitness — `@Global()` discussion.
