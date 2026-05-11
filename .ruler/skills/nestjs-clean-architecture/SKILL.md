---
name: nestjs-clean-architecture
description: Use when designing or reviewing a NEW domain module in this repo (`src/modules/<domain>/`), or when refactoring an existing module that has grown business invariants past the "simple CRUD" exemption. Provides the 4-layer structure (presentation/application/domain/infrastructure), dependency rule, repository port + adapter pattern, and concrete patterns adapted to api-velocity's ADRs (TypeORM, NestJS Logger, no class-validator, NestJS built-in exceptions). NOT for `admin/dashboard`-style flat modules with no business invariants, NOT for adding a route to an existing module that already follows the convention, NOT for raw-SQL legacy modules (those stay as-is per ADR-001).
---

# NestJS Clean Architecture (api-velocity)

## When this skill fires

- Designing a new domain module under `src/modules/<domain>/` (controller + service + persistence).
- Reviewing a plan or PR that introduces a new module.
- Refactoring an existing flat module (e.g., `admin/dashboard` if it grew invariants) into the layered structure.
- The user asks "how should I structure this module" or "where does X go".

## When this skill does NOT fire

- Adding a single route to a module that already follows the convention — use `repo-conventions` § 2 instead, no need for the full skill.
- Modifying the `admin/dashboard` flat module — it's exempt per `ADR-009` (no business invariants).
- The legacy raw-SQL modules (`projects`, `chat`, `admin/users` if they still use raw SQL) — `ADR-001` says they stay; don't migrate as a side-effect.
- Generic NestJS questions about providers, guards, pipes — use `nestjs-best-practices` or `nestjs-patterns` instead.

## Authority

This skill is the implementation guide for `ADR-009` (Clean architecture / hexagonal layering for new modules). When this skill conflicts with another skill, `ADR-009` is the binding rule; cite it (`Per ADR-009, ...`) rather than re-arguing.

## The 4-layer structure

```
src/modules/<domain>/
├── <domain>.module.ts                              ← NestJS module wiring
├── api/                                            ← PRESENTATION
│   ├── controllers/<domain>.controller.ts
│   └── dto/                                        ← Plain TS types per ADR-005 (no class-validator)
│       └── <action>.dto.ts
├── application/                                    ← APPLICATION
│   └── services/<aggregate>.service.ts             ← Use cases / orchestration
├── domain/                                         ← DOMAIN (pure)
│   ├── entities/
│   │   └── <aggregate>.entity.ts                   ← Identity + invariants
│   └── repositories/
│       └── <aggregate>.repository.interface.ts     ← Port (interface + Symbol token)
└── infrastructure/                                 ← INFRASTRUCTURE
    └── persistence/
        ├── entities/
        │   └── <aggregate>.typeorm-entity.ts       ← TypeORM entity class
        └── repositories/
            └── <aggregate>.typeorm-repository.ts   ← Adapter implementing the port
```

Canonical example: [src/modules/admin/rbac/](../../../src/modules/admin/rbac/). When in doubt about where something belongs, check what RBAC does.

## The dependency rule

Inner layers (domain) must never depend on outer layers. Allowed and forbidden imports:

| File location | Allowed imports | Forbidden imports |
|---|---|---|
| `domain/**` | `domain/**` (within the same module), pure TypeScript / standard lib | `@nestjs/common` injectable decorators, `@nestjs/typeorm`, `typeorm`, anything from `application/`, `infrastructure/`, `api/` |
| `application/**` | `domain/**`, `@nestjs/common` (for `@Injectable`, `@Inject`, NestJS built-in exceptions) | `infrastructure/**` direct imports (use the port via DI), `api/**` |
| `infrastructure/**` | `domain/**` (to implement ports), `@nestjs/typeorm`, `typeorm`, NestJS DI decorators | `application/**`, `api/**` |
| `api/**` | `application/**` (to invoke services), `domain/**` (for response types only — never for persistence calls), `@nestjs/common` | `infrastructure/**` directly |

**Violations.** A `domain/*.ts` file with `import { Injectable } from '@nestjs/common'` or `import { Repository } from 'typeorm'` is a HIGH dependency-rule violation (per `ADR-009`). The `architect-reviewer` and `code-reviewer` flag these.

## Pattern 1 — Domain entity (identity + invariants)

Plain TypeScript class. No `@Injectable`, no decorators from `@nestjs/typeorm`. Constructor enforces invariants; mutation methods enforce state-transition rules.

```typescript
// domain/entities/role.entity.ts
export class Role {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly organizationId: string,
    private readonly permissions: string[] = [],
  ) {
    if (!name.trim()) throw new Error('Role name is required');
    if (name.length > 100) throw new Error('Role name too long');
  }

  hasPermission(verb: string, resource: string): boolean {
    return this.permissions.includes(`${verb}:${resource}`);
  }

  withPermission(verb: string, resource: string): Role {
    if (this.hasPermission(verb, resource)) return this;
    return new Role(this.id, this.name, this.organizationId, [...this.permissions, `${verb}:${resource}`]);
  }

  getPermissions(): readonly string[] { return [...this.permissions]; }
}
```

Note: domain entities throw plain `Error` for invariant violations. The application layer catches and re-throws as NestJS built-in exceptions (per `ADR-003`) so HTTP semantics happen at the boundary, not in pure domain code.

## Pattern 2 — Value object (when an attribute has invariants)

Optional. Use when an attribute (email, money, scope, etc.) has its own validation/equality rules. Private constructor + static factory method, immutable, pure equality.

```typescript
// domain/value-objects/email.vo.ts
export class Email {
  private constructor(private readonly value: string) {}

  static create(input: string): Email {
    const trimmed = input.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      throw new Error(`Invalid email format: ${input}`);
    }
    return new Email(trimmed);
  }

  toString(): string { return this.value; }
  equals(other: Email): boolean { return this.value === other.value; }
}
```

Don't pre-emptively introduce value objects. Add one when the same string-with-rules is being passed across multiple methods and you find yourself re-validating it.

## Pattern 3 — Repository port (domain interface + Symbol token)

The contract is defined in `domain/repositories/`. Pure TypeScript interface + a Symbol for DI token.

```typescript
// domain/repositories/role.repository.interface.ts
import { Role } from '../entities/role.entity';

export interface RoleRepositoryPort {
  findById(id: string, organizationId: string): Promise<Role | null>;
  findByOrganization(organizationId: string): Promise<Role[]>;
  save(role: Role): Promise<void>;
  delete(id: string, organizationId: string): Promise<void>;
}

export const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');
```

Two rules:
- **Methods are domain-shaped, not query-shaped.** `findByOrganization(orgId)` not `findAll({ where: { orgId } })`. The interface speaks the domain's language; the adapter translates.
- **Org-scoping is in the signature.** Per `repo-conventions` § 3 + `ADR-002`, every org-scoped query takes `organizationId` explicitly. The port surfaces that contract.

## Pattern 4 — Repository adapter (TypeORM in infrastructure)

The adapter lives in `infrastructure/persistence/repositories/`. It uses `@InjectRepository`, talks to TypeORM, and **maps between the TypeORM entity and the domain entity**.

```typescript
// infrastructure/persistence/entities/role.typeorm-entity.ts
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity({ name: 'roles' })
export class RoleTypeOrmEntity {
  @PrimaryColumn('uuid') id: string;
  @Column() name: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column({ type: 'text', array: true, default: [] }) permissions: string[];
}
```

```typescript
// infrastructure/persistence/repositories/role.typeorm-repository.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../../domain/entities/role.entity';
import { RoleRepositoryPort } from '../../../domain/repositories/role.repository.interface';
import { RoleTypeOrmEntity } from '../entities/role.typeorm-entity';

@Injectable()
export class RoleTypeOrmRepository implements RoleRepositoryPort {
  private readonly logger = new Logger(RoleTypeOrmRepository.name);

  constructor(
    @InjectRepository(RoleTypeOrmEntity)
    private readonly repo: Repository<RoleTypeOrmEntity>,
  ) {}

  async findById(id: string, organizationId: string): Promise<Role | null> {
    const row = await this.repo.findOne({ where: { id, organizationId } });
    return row ? this.toDomain(row) : null;
  }

  async findByOrganization(organizationId: string): Promise<Role[]> {
    const rows = await this.repo.find({ where: { organizationId } });
    return rows.map((r) => this.toDomain(r));
  }

  async save(role: Role): Promise<void> {
    await this.repo.save(this.toPersistence(role));
  }

  async delete(id: string, organizationId: string): Promise<void> {
    await this.repo.delete({ id, organizationId });
  }

  private toDomain(row: RoleTypeOrmEntity): Role {
    return new Role(row.id, row.name, row.organizationId, row.permissions);
  }

  private toPersistence(role: Role): RoleTypeOrmEntity {
    const entity = new RoleTypeOrmEntity();
    entity.id = role.id;
    entity.name = role.name;
    entity.organizationId = role.organizationId;
    entity.permissions = [...role.getPermissions()];
    return entity;
  }
}
```

Three rules:
- **Two-way mapping is the adapter's job.** Domain entity in, TypeORM entity out — and vice versa. Don't expose the TypeORM type beyond `infrastructure/`.
- **Belt + suspenders org scoping.** Even though the port enforces it, the SQL `WHERE organizationId` is also present (per `repo-conventions` § 3).
- **Adapter logs at infrastructure level.** Application logs business intent; adapter logs persistence operations. Per `ADR-004`, NestJS Logger only.

## Pattern 5 — Application service (use case / orchestrator)

Lives in `application/services/`. Constructor-injected with the **port token**, not the concrete class. Maps domain errors to NestJS built-in exceptions per `ADR-003`.

```typescript
// application/services/role.service.ts
import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Role } from '../../domain/entities/role.entity';
import { RoleRepositoryPort, ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';

@Injectable()
export class RoleService {
  constructor(
    @Inject(ROLE_REPOSITORY)
    private readonly roles: RoleRepositoryPort,
  ) {}

  async grantPermission(
    roleId: string,
    organizationId: string,
    verb: string,
    resource: string,
  ): Promise<Role> {
    const role = await this.roles.findById(roleId, organizationId);
    if (!role) throw new NotFoundException(`Role ${roleId} not found in organization`);

    let updated: Role;
    try {
      updated = role.withPermission(verb, resource);
    } catch (e) {
      // Domain threw a plain Error for an invariant violation; map to HTTP semantics.
      throw new BadRequestException(e instanceof Error ? e.message : 'Invalid permission');
    }

    await this.roles.save(updated);
    return updated;
  }
}
```

Two rules:
- **Inject the port token, not the adapter.** `@Inject(ROLE_REPOSITORY)` with type `RoleRepositoryPort`. The adapter is wiring detail; the service must not know about TypeORM.
- **Translate domain errors at this boundary.** Domain throws `Error`; the service wraps to NestJS built-in exceptions. This keeps domain pure and HTTP semantics correct.

## Pattern 6 — Controller (presentation / HTTP adapter)

Lives in `api/controllers/`. Thin — only HTTP concerns. Uses helper validators (per `ADR-005`) instead of class-validator.

```typescript
// api/controllers/role.controller.ts
import { Controller, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from 'src/shared/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/shared/guards/permissions.guard';
import { RequirePermissions } from 'src/shared/decorators/permissions.decorator';
import { resolveOrgScope } from 'src/modules/admin/users/utils/org-scope.utils';
import { RoleService } from '../../application/services/role.service';
import { GrantPermissionDto } from '../dto/grant-permission.dto';
import { requireString, requireUuid } from 'src/shared/validators';

@Controller('admin/roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Post(':id/permissions')
  @RequirePermissions('write:roles')
  async grant(@Param('id') id: string, @Body() dto: GrantPermissionDto, @Req() req: any) {
    const orgScope = resolveOrgScope(req); // returns { mode: 'single', organizationId } per ADR-002
    requireUuid(id, 'id');
    requireString(dto.verb, 'verb');
    requireString(dto.resource, 'resource');
    return this.roleService.grantPermission(id, orgScope.organizationId, dto.verb, dto.resource);
  }
}
```

```typescript
// api/dto/grant-permission.dto.ts
export interface GrantPermissionDto {
  verb: string;
  resource: string;
}
```

Two rules:
- **Controller does NOT call the repository directly.** It only calls the application service. (`api → application → domain ↔ infrastructure`.)
- **DTOs are plain types.** Per `ADR-005`, no class-validator decorators. Validation happens via helper functions at the controller boundary; domain validates again via constructors.

## Pattern 7 — Module wiring (interface-token providers)

`<domain>.module.ts` registers the controller, the application service, and the **interface-token provider** mapping the port to the adapter.

```typescript
// rbac.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleController } from './api/controllers/role.controller';
import { RoleService } from './application/services/role.service';
import { ROLE_REPOSITORY } from './domain/repositories/role.repository.interface';
import { RoleTypeOrmEntity } from './infrastructure/persistence/entities/role.typeorm-entity';
import { RoleTypeOrmRepository } from './infrastructure/persistence/repositories/role.typeorm-repository';

@Module({
  imports: [TypeOrmModule.forFeature([RoleTypeOrmEntity])],
  controllers: [RoleController],
  providers: [
    RoleService,
    { provide: ROLE_REPOSITORY, useClass: RoleTypeOrmRepository },
  ],
  exports: [RoleService],
})
export class RbacModule {}
```

The `{ provide: ROLE_REPOSITORY, useClass: RoleTypeOrmRepository }` line is what makes the dependency rule actually work in the DI container — the application service receives an adapter that satisfies the port without knowing it's TypeORM.

## Anti-patterns (each is a HIGH dependency-rule finding)

```typescript
// ❌ domain entity importing TypeORM
// domain/entities/role.entity.ts
import { Entity, Column } from 'typeorm'; // HIGH — domain depends on infrastructure
```

```typescript
// ❌ application service injecting the adapter directly
// application/services/role.service.ts
constructor(private readonly roles: RoleTypeOrmRepository) {} // HIGH — bypasses the port
```

```typescript
// ❌ domain entity with @Injectable
// domain/entities/role.entity.ts
@Injectable()  // HIGH — domain depends on @nestjs/common runtime
export class Role {}
```

```typescript
// ❌ controller calling the repository directly, skipping the service
// api/controllers/role.controller.ts
constructor(@Inject(ROLE_REPOSITORY) private readonly roles: RoleRepositoryPort) {}
async grant() { return this.roles.save(...); } // HIGH — bypasses application layer
```

```typescript
// ❌ TypeORM entity treated as the domain entity
// (no separate Role class in domain/entities/, just RoleTypeOrmEntity)
// HIGH — leaky abstraction; ORM annotations bleed into the rest of the codebase
```

## Testing implications

The dependency rule pays off here: domain entity tests need NO NestJS testing module, no `@nestjs/typeorm` mock, no DI. They're pure unit tests.

```typescript
// domain/entities/role.entity.spec.ts
describe('Role', () => {
  it('rejects empty name', () => {
    expect(() => new Role('id', '', 'org')).toThrow('required');
  });

  it('grants a permission idempotently', () => {
    const r1 = new Role('id', 'admin', 'org');
    const r2 = r1.withPermission('read', 'users');
    const r3 = r2.withPermission('read', 'users');
    expect(r2.getPermissions()).toEqual(['read:users']);
    expect(r3.getPermissions()).toEqual(['read:users']); // no duplicate
  });
});
```

For application services, mock the port (not the adapter):

```typescript
// application/services/role.service.spec.ts
const mockRepo: RoleRepositoryPort = { findById: jest.fn(), save: jest.fn(), /* ... */ };
const service = new RoleService(mockRepo);
```

For adapters, integration test against a real test database (per `repo-conventions` § Tests; raw-SQL fallback advice applies the same way to TypeORM).

## Cross-references

- [`ADR-009`](../../../docs/decisions/ADR-009-clean-architecture-layering-for-modules.md) — the binding decision; this skill is the implementation guide.
- [`ADR-001`](../../../docs/decisions/ADR-001-typeorm-first-persistence.md) — TypeORM-first persistence (extended by ADR-009).
- [`ADR-002`](../../../docs/decisions/ADR-002-rbac-scope-all-returns-400.md) — RBAC scope contract (port methods take `organizationId` explicitly).
- [`ADR-003`](../../../docs/decisions/ADR-003-no-global-exception-filter.md) — application service maps domain errors to NestJS built-ins.
- [`ADR-005`](../../../docs/decisions/ADR-005-no-class-validator-no-validation-pipe.md) — DTOs are plain TS types.
- `repo-conventions` § 2 (module layout), § 3 (RBAC scope contract), § 4 (repository pattern), § 6 (error handling), § 7 (Logger), § 8 (DTOs).
- `nestjs-best-practices` `arch-use-repository-pattern`, `arch-feature-modules`, `arch-single-responsibility`, `di-interface-segregation`.
- [src/modules/admin/rbac/](../../../src/modules/admin/rbac/) — canonical example.

## Anti-patterns specific to this repo

- **Putting `class-validator` decorators on DTOs in `api/dto/`.** Use helper validators (`requireString`, `requireUuid`, etc.) per `ADR-005`. If you genuinely need class-validator, that's an asks-first decision per `ADR-006`.
- **`@nestjs/cqrs` `AggregateRoot` base class.** Not in our deps. If you genuinely need event sourcing, propose an ADR + asks-first dep gate.
- **Domain events without an event bus.** We don't have one. Don't pre-emptively scaffold one — handle cross-module reactions via direct service calls until the cost outweighs the benefit, then propose an ADR.
- **Skipping the layered split for "simple" modules.** The exemption is "no business invariants" (per `ADR-009`). If the module has even one rule like "a Role with no permissions is invalid" or "an Order can't be cancelled after shipping", it has invariants — full layering applies.
