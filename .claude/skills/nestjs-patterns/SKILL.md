---
name: nestjs-patterns
description: Use when designing or reviewing NestJS providers (`useFactory:` / async init / env-driven creation / `forRoot`/`forRootAsync`/`forFeature` dynamic modules / `@Global()` / `Scope.REQUEST` / `Scope.TRANSIENT`), cross-cutting layers (Guard / Pipe / Interceptor / Middleware decisions), or parameterized guards/interceptors via the `mixin()` helper. Index of 5 tactical patterns; route to the relevant file in patterns/ for depth. NOT for plain class providers (use `useClass:`), simple feature modules without consumer config, or generic NestJS questions (use `nestjs-best-practices` instead).
---

# NestJS Tactical Patterns

Index skill for 5 NestJS-specific tactical patterns this codebase frequently encounters. Each pattern has its own file in [patterns/](patterns/) with full anti-pattern catalog, decision tree, and repo-fit examples.

Read this SKILL.md to identify which pattern applies; then read the specific pattern file for the depth.

This skill is for **repo-fit tactical guidance**. For comprehensive generic NestJS rules (40 rules across architecture, DI, security, perf, testing), see `nestjs-best-practices` instead. The two skills are complementary: `nestjs-best-practices` is the encyclopedia; `nestjs-patterns` is the tactical playbook with this codebase's actual files cited.

## Patterns (index)

| Pattern | When to invoke | Depth |
|---|---|---|
| **factory-providers** | NestJS provider whose creation depends on env values, requires async initialization (DB, Redis, secret manager), or composes multiple existing providers. Reach for `useFactory:` instead of `useClass:`. | [patterns/factory-providers.md](patterns/factory-providers.md) |
| **dynamic-modules** | Module needs runtime configuration from its consumer (`forRoot`/`forRootAsync`/`forFeature`/`register`) or `@Global()` consideration. RBAC's `TypeOrmModule.forFeature([...])` is the canonical example. | [patterns/dynamic-modules.md](patterns/dynamic-modules.md) |
| **cross-cutting** | Choosing between Guard / Pipe / Interceptor / Middleware for a cross-cutting concern. Pipeline order + decision tree to avoid the wrong-layer antipattern (authz in interceptor, validation in guard). | [patterns/cross-cutting.md](patterns/cross-cutting.md) |
| **provider-scopes** | Provider needs per-request or per-injection state (multi-tenancy, `Scope.REQUEST`, `Scope.TRANSIENT`). Inverted skill: when to opt OUT of singleton, since NestJS providers are singletons by default. | [patterns/provider-scopes.md](patterns/provider-scopes.md) |
| **mixins** | Parameterized Guard or Interceptor that needs DI (the `mixin()` helper from `@nestjs/common`). Non-obvious — most engineers don't know this exists. | [patterns/mixins.md](patterns/mixins.md) |

## Quick decision tree (which pattern do I need?)

```
Is the work about a NestJS provider's creation or lifetime?
├── Creation depends on env / async / composition?  → factory-providers
├── Need per-request or per-injection state?         → provider-scopes
└── Module needs runtime config from consumer?       → dynamic-modules

Is the work about cross-cutting behavior?
├── Choosing the right layer (Guard / Pipe / Interceptor / Middleware)?  → cross-cutting
└── Parameterized Guard/Interceptor with DI?                              → mixins
```

## Common LLM mistakes (across all 5 patterns)

The full per-pattern mistake catalogs live in each pattern file. Three recurring themes across all 5:

1. **Reinventing what NestJS already gives you.** Hand-rolled factory functions when `useFactory:` exists; manual singleton management when default scope already is singleton; custom proxy classes when Interceptors already solve the problem.
2. **Wrong layer for cross-cutting work.** Authorization in an interceptor, validation in a guard, response shaping in a pipe — see `patterns/cross-cutting.md`.
3. **Lost DI in parameterized guards.** Naive factory functions returning anonymous classes lose `@Injectable()` semantics — see `patterns/mixins.md`.

## When this skill does NOT fire

- **Plain class providers** with constructor-injected deps → `useClass:` or implicit registration.
- **Simple feature modules** whose providers and imports are fixed at module-definition time → static `@Module({...})`.
- **Stateless services** → singleton scope (default) is correct; don't reach for `provider-scopes` here.
- **Generic NestJS questions** (architectural rules, DI principles, framework idioms unrelated to these 5 specific patterns) → use `nestjs-best-practices`.
- **Repo conventions** (NestJS exceptions vs. plain `Error`, RBAC scope contract, persistence choice) → use `repo-conventions`.

## Cross-references

- `nestjs-best-practices` — comprehensive 40-rule encyclopedia (`arch-*`, `di-*`, `error-*`, `security-*`, `perf-*`, `api-*`, `test-*`, `db-*`, `micro-*`, `devops-*`).
- `repo-conventions` — TypeORM-first persistence, RBAC scope contract, error handling, logger discipline.
- `database-transactions` — when patterns touch multi-statement DB work (TypeORM `manager.transaction(...)` or raw-SQL `DatabaseService.transaction(...)`).
- `CLAUDE.md` P3.4 mandatory matrix — when this skill fires alongside `tdd-workflow`, `failure-mode-analysis`, etc.
