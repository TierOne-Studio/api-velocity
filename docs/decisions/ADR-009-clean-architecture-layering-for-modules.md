# ADR-009: Clean architecture / hexagonal layering for new modules

**Status:** Accepted
**Date:** 2026-04-30
**Deciders:** core engineering team

## Context

After reviewing the actual module layout in `src/modules/`, the layered (clean-architecture / hexagonal) pattern is **already the dominant convention in this repo** — just never formally documented:

| Module | Structure |
|---|---|
| `admin/rbac/` | `api/` + `application/services/` + `domain/{entities,repositories}/` + `infrastructure/persistence/{entities,repositories}/` |
| `chat/` | `api/` + `application/` + `domain/repositories/` + `infrastructure/persistence/` |
| `projects/` | `api/` + `application/` + `domain/repositories/` + `infrastructure/persistence/` |
| `admin/users/` | `api/` + `application/` + `domain/` + `infrastructure/` |
| `admin/organizations/` | `api/` + `application/` + `domain/` + `infrastructure/` |
| `admin/sessions/` | `api/` + `application/` + `domain/` + `infrastructure/` |
| `airweave/` | `api/` + `application/` + `infrastructure/` (no `domain/` yet) |
| `admin/dashboard/` | **Flat** — `dashboard.controller.ts` + `dashboard.service.ts` + `dto/` |

The layered pattern is in 7 of 8 modules; only `admin/dashboard` is flat. Despite this, the convention is **invisible to a contributor (or AI agent) reading the codebase cold**:

- `repo-conventions` § 2 documents the basic module layout (`controllers/`, `services/`, `dto/`, `infrastructure/persistence/`) but does not name the dependency rule, the port/adapter terminology, or which layer owns which concern.
- `ADR-001` says "TypeORM-first for new modules" but doesn't say *where* the TypeORM repo lives or that it implements an interface defined elsewhere.
- The `architect-reviewer` and `code-reviewer` subagents have no rule for flagging a new module that flattens these layers or violates the dependency direction.

This means a future contributor (human or AI) writing module #9 could land it as flat NestJS, copy `admin/dashboard`, or invent a different split — and pass review. We've already absorbed the cost of the layered pattern. We get little benefit from it without codifying the rule.

The asks-first / P3.5 framing applies here: this is a **structural decision** that affects how every new module is organized. No new dependency is required (NestJS + TypeORM are already the stack). The change is purely organizational discipline + reviewer-side enforcement.

## Decision

**New modules under `src/modules/<domain>/` follow this 4-layer structure with a strict dependency rule.** Existing layered modules (rbac, chat, projects, admin/users, admin/organizations, admin/sessions) already comply; `admin/dashboard` and small CRUD-only modules are exempt (see Consequences).

### Layer responsibilities

| Layer | Folder | Owns |
|---|---|---|
| **Presentation** | `api/controllers/` + `api/dto/` | HTTP routing, request/response shape, transport-level validation, mapping HTTP errors |
| **Application** | `application/services/` (or `application/use-cases/` for use-case-shaped logic) | Business workflow orchestration, transaction boundaries, mapping domain errors to NestJS built-in exceptions (`ADR-003`) |
| **Domain** | `domain/entities/` + `domain/repositories/` | Pure business rules, identity, invariants. **Repository ports** are TypeScript interfaces here (`role.repository.interface.ts`). NO `@Injectable`, NO `@nestjs/typeorm` imports, NO HTTP types |
| **Infrastructure** | `infrastructure/persistence/entities/` + `infrastructure/persistence/repositories/` | TypeORM entity classes (`role.typeorm-entity.ts`), repository adapter classes (`role.typeorm-repository.ts`) implementing the domain interface, mappers between TypeORM entity and domain entity |

### Dependency rule

- `application` may import from `domain`. Never the reverse.
- `infrastructure` may import from `domain` (to implement ports) and from `application` (to be injected). Never the reverse.
- `api` imports from `application` (to invoke services / use cases) and from `domain` (for response types only — never for persistence). Never the reverse.
- `domain` imports nothing from `application`, `infrastructure`, or `api`.

A `domain/*.ts` file containing `import` from `@nestjs/common`, `@nestjs/typeorm`, or any `infrastructure/` path is a **HIGH** finding — that's a dependency-rule violation.

### Repository ports

Repository contracts live in `domain/repositories/<aggregate>.repository.interface.ts` as a plain TypeScript interface plus a Symbol token for DI:

```typescript
export interface RoleRepositoryPort {
  findById(id: string): Promise<Role | null>;
  save(role: Role): Promise<void>;
}
export const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');
```

The TypeORM adapter in `infrastructure/persistence/repositories/<aggregate>.typeorm-repository.ts` implements the port and provides the mapper between the TypeORM entity (in `infrastructure/persistence/entities/`) and the domain entity (in `domain/entities/`). Wiring uses interface-token providers in the module:

```typescript
providers: [
  { provide: ROLE_REPOSITORY, useClass: RoleTypeOrmRepository },
],
```

This is exactly what the RBAC module already does — see [src/modules/admin/rbac/rbac.module.ts](src/modules/admin/rbac/rbac.module.ts) and [src/modules/admin/rbac/infrastructure/persistence/repositories/role.typeorm-repository.ts](src/modules/admin/rbac/infrastructure/persistence/repositories/role.typeorm-repository.ts).

### What this ADR explicitly does NOT mandate

- **Value objects, aggregates as separate folders.** RBAC and projects don't have them today; modules can introduce them when invariants warrant it, but they're not required for ADR-009 compliance.
- **Domain events as a first-class concept.** No event bus is defined in this repo. Future ADR if/when needed.
- **CQRS read/write separation.** Overkill for our scale.
- **`@nestjs/cqrs` `AggregateRoot` base class.** New dependency; subject to `ADR-006` asks-first if proposed later.
- **Migration of existing flat or partial modules.** `admin/dashboard` stays flat; `airweave` adds `domain/` only when it grows business invariants. Per `ADR-001`'s forward-looking framing.
- **Refactor of existing layered modules to "fix" minor naming inconsistencies.** RBAC uses `role.entity.ts` (domain) and `role.typeorm-entity.ts` (TypeORM); other modules may use slightly different file names. Consistency is desirable but not retroactively enforced.

### Exemption: simple CRUD modules

A module with NO business invariants — purely a thin pass-through from controller to DB query — does not need the full 4-layer split. `admin/dashboard` is the canonical exempt case (it computes aggregate counts; no entities, no invariants). Mark such modules with a comment in their main file:

```typescript
// Architectural note: flat structure intentional per ADR-009 — no business
// invariants; pure aggregation/projection.
```

A module that starts flat and accumulates invariants should be migrated to the layered structure. That's a normal feature task, not a separate ADR.

## Alternatives considered

- **Strict hexagonal-only with separate `ports/` tree** (e.g., `domain/ports/in/`, `domain/ports/out/`). Rejected: extra ceremony for the size of this repo. Repository interfaces in `domain/repositories/` are already ports — calling them ports doesn't change behavior.
- **Full DDD with value objects, aggregates, domain events as required folders.** Rejected: pre-emptive complexity. Value objects are useful when an attribute has invariants (e.g., `Email`, `Money`), but not every domain has them. Mandating them creates churn without benefit.
- **`@nestjs/cqrs` for `AggregateRoot` + domain events.** Rejected: new npm dependency + structural bootstrap change. Subject to `ADR-006` asks-first if proposed.
- **Status quo (Option C from prior discussion: 7/8 modules layered, no formal convention).** Rejected: invisible to new contributors; no reviewer enforcement; future modules drift.
- **Aggressive: migrate `admin/dashboard` and `airweave` to fully layered.** Rejected: forced refactor for marginal benefit. Forward-looking convention only, per `ADR-001` precedent.

## Consequences

### Positive

- The layered convention becomes **discoverable**: `repo-conventions` cites this ADR; `architect-reviewer` checks the dependency rule on new modules; the `nestjs-clean-architecture` skill (to be added if this ADR Accepts) gives concrete patterns.
- Domain layer is testable without NestJS — pure unit tests on entities and domain logic.
- Persistence is swappable: replacing TypeORM with another driver means rewriting only `infrastructure/persistence/`.
- New contributors and AI agents have a single canonical example (RBAC) to copy.
- Dependency-rule violations are caught at review time, not after they've spread.

### Negative

- More files per new module than a flat NestJS layout (typically 3-4× the file count).
- Mappers between TypeORM entities and domain entities are boilerplate; they have to be written and maintained.
- Learning curve for contributors who've only seen flat NestJS — though this curve already exists implicitly (RBAC is the documented canonical example in `repo-conventions`).
- The line between "needs the full layering" and "exempt as simple CRUD" is judgment-based; reviewers will need to argue some cases.
- `admin/dashboard` is now formally an outlier; either it stays so or someone migrates it later.

### Implementation (landed alongside this ADR)

1. **New skill `nestjs-clean-architecture`** in `.claude/skills/` with the full patterns: domain entity, value object (when needed), repository port + adapter, mapper, application service, controller. Adapted from external sources (`designing-hexagonal-architecture` and `clean-architecture-for-nestjs`), trimmed to fit our existing ADRs (no `@nestjs/cqrs`, no `class-validator` per `ADR-005`, NestJS built-in exceptions in the application layer per `ADR-003`, TypeORM adapters per `ADR-001`).
2. **`repo-conventions` § 2 + § 4** cite this ADR; the ADR-citation table at the top of `repo-conventions` includes ADR-009.
3. **`CLAUDE.md` Skill Pointers** has a row for the new skill; **Workflow chains** extends the "Structural decision" recipe and adds a "New domain module" recipe.
4. **`architect-reviewer` Step 6 compliance audit** checks the dependency rule: domain importing from `@nestjs/typeorm` / `infrastructure/` / `application/` / `api/` = **HIGH**; module with business invariants but no `domain/repositories/` ports = **MED**; naming inconsistencies = **LOW**.
5. **`code-reviewer` Step 4 repo-conventions check** mirrors the dependency-rule check at PR-review time.
6. **Acceptance T71** verifies all the above stay wired (skill structure, repo-conventions citation, CLAUDE.md row + chain, both reviewers' dependency-rule audit).

## References

- `CLAUDE.md` § P3.5 — skill-vs-repo conflict resolution (this ADR is the deliberate adoption path).
- `ADR-001` — TypeORM-first persistence (this ADR extends it; doesn't supersede).
- `ADR-003` — No global exception filter (application layer maps domain errors to NestJS built-ins).
- `ADR-005` — No class-validator on DTOs (DTOs in `api/dto/` stay plain TypeScript types).
- `ADR-006` — Asks-first dep gate (this ADR adds no new dep, so the gate doesn't trigger; but if a future PR proposes `@nestjs/cqrs` for aggregates, the gate applies).
- [src/modules/admin/rbac/](src/modules/admin/rbac/) — canonical example of the convention.
- [src/modules/admin/rbac/domain/repositories/role.repository.interface.ts](src/modules/admin/rbac/domain/repositories/role.repository.interface.ts) — canonical repository port.
- [src/modules/admin/rbac/infrastructure/persistence/repositories/role.typeorm-repository.ts](src/modules/admin/rbac/infrastructure/persistence/repositories/role.typeorm-repository.ts) — canonical adapter.

## Calibration choices captured at Acceptance

The three calibration questions raised at Proposed-stage were resolved as the Proposed defaults:

1. **Convention scope:** layered structure for new modules going forward; no forced migration of existing layered modules' minor inconsistencies; `admin/dashboard` and `airweave` (currently flat or partial-layered) stay as-is until they grow business invariants.
2. **Exemption test:** "no business invariants" — a module that's pure CRUD/projection (controller → DB query, no entities, no aggregate-state rules) does not need the full 4-layer split. `admin/dashboard` is the canonical exempt case.
3. **Reviewer enforcement strictness:**
   - Domain-layer file importing from `@nestjs/typeorm`, `@nestjs/common` injectable decorators, or any `infrastructure/`/`application/`/`api/` path → **HIGH** finding.
   - Module with business invariants but no `domain/repositories/<aggregate>.repository.interface.ts` port → **MED**.
   - Naming inconsistencies (e.g., `role.entity.ts` vs `role-entity.ts`, `*.repository.ts` vs `*.typeorm-repository.ts`) → **LOW**.

Future experience may surface edge cases that warrant superseding this ADR. Until then, the rules above are the binding interpretation.
