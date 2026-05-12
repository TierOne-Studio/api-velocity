---
name: cyclomatic-complexity
description: Use when writing or reviewing functions with multiple branches, nested conditionals, or growing if-else chains — to reduce cyclomatic complexity via early returns, guard clauses, and extract-method. NOT for inherently linear code, simple two-branch conditions, or framework-imposed structure (NestJS decorators, route handlers with one path).
---

# Cyclomatic Complexity — Early Returns and Flat Functions

A function's cyclomatic complexity is the number of linearly independent paths through it (≈ branches + 1). High complexity means hard to test, hard to read, hard to change without breaking. The fix is rarely "split into smaller functions for the sake of it" — it's specific tactics: **early returns, guard clauses, extract method, replace nested conditional, simplify boolean expressions.**

LLMs default to nested if-else pyramids and `else` branches that should have been early returns. This skill encodes the tactics to flatten them.

## When this fires

- A function has 3+ levels of nesting.
- A function has multiple `if` chains that each check related preconditions.
- A function has nested ternaries (`a ? b : c ? d : e`).
- A function exceeds ~15 lines of branchy logic.
- A function has a long `else if ... else if ... else` chain over the same value.
- A code review shows a method that's "hard to follow."

## When this does NOT fire

- The function is genuinely linear (no branches, just sequential awaits/returns).
- One simple `if/else` returning two cases.
- Framework-imposed structure (e.g., a NestJS controller method with one path).
- Configuration-style data (a switch over an enum where each branch is a single line — splitting it doesn't help).

## Rough metric (not a hard rule)

| Cyclomatic complexity | Verdict |
|---|---|
| 1–4 | Fine. Don't refactor for the metric. |
| 5–7 | Yellow. Look for early-return wins. |
| 8–10 | Refactor before adding more. |
| 11+ | Hard to test, hard to change. Refactor before this work merges. |

The metric is a smell, not a rule. A 5-complexity function with a clear domain meaning is fine; a 5-complexity function with three nested `if`s checking preconditions is not.

## Tactic 1: Early returns (the highest-leverage move)

Replace nested validation with guard clauses that return early. Each early return reduces the depth of the "happy path" and makes preconditions visible at the top.

### Anti-pattern: nested validation pyramid

```ts
// ❌ 4 levels of nesting; happy path is buried
async findOne(id: string, scope: OrgScope): Promise<Project> {
  if (scope) {
    if (scope.mode === 'single') {
      if (scope.organizationId) {
        const project = await this.repo.findById(id, scope.organizationId)
        if (project) {
          return project
        } else {
          throw new NotFoundException(`Project ${id} not found`)
        }
      } else {
        throw new BadRequestException('organization id required')
      }
    } else {
      throw new BadRequestException('scope=all not supported here')
    }
  } else {
    throw new ForbiddenException('scope required')
  }
}
```

### Refactor: guard clauses + happy path at the bottom

```ts
// ✅ Each precondition is a guard; happy path is unindented
async findOne(id: string, scope: OrgScope): Promise<Project> {
  if (!scope) throw new ForbiddenException('scope required')
  if (scope.mode !== 'single') throw new BadRequestException('scope=all not supported here')
  if (!scope.organizationId) throw new BadRequestException('organization id required')

  const project = await this.repo.findById(id, scope.organizationId)
  if (!project) throw new NotFoundException(`Project ${id} not found`)
  return project
}
```

Cyclomatic complexity dropped (still 5, but readability dramatically improved). Each guard says "this *must* be true to proceed."

### Rule of thumb

> If you find yourself writing `else { throw ... }` or `else { return null }`, flip it: the `if` should throw/return; the rest of the function shouldn't be in an `else`.

## Tactic 2: Eliminate `else` after `return`/`throw`

```ts
// ❌ Pointless else
function classify(score: number): string {
  if (score >= 90) {
    return 'A'
  } else if (score >= 80) {
    return 'B'
  } else if (score >= 70) {
    return 'C'
  } else {
    return 'F'
  }
}

// ✅ Linear cascade — no nesting depth at all
function classify(score: number): string {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  return 'F'
}
```

The `else` after a `return` is dead syntax. Remove it.

## Tactic 3: Replace nested ternaries with named functions or if/else

```ts
// ❌ Nested ternaries — unparseable on grep, debugger, diff review
const role = isAdmin ? 'admin' : isEditor ? 'editor' : isViewer ? 'viewer' : 'guest'

// ✅ Named function — intent is in the name; flow is in the body
function resolveRole(perms: Perms): Role {
  if (perms.isAdmin) return 'admin'
  if (perms.isEditor) return 'editor'
  if (perms.isViewer) return 'viewer'
  return 'guest'
}
const role = resolveRole(perms)
```

`code-simplifier` already prohibits nested ternaries. This skill explains *what to replace them with*.

## Tactic 4: Extract method when a block has its own name

When a block within a function does one named thing — and the function's job is "orchestrate several named things" — extract the block. The receiving function becomes a list of well-named operations; each extracted method is independently testable.

### Anti-pattern: god method orchestrating untyped steps

```ts
// ❌ One big method. Each section is a "step" but they're not labeled.
async createProjectWithSource(input: CreateProjectInput, scope: OrgScope): Promise<Project> {
  if (!scope.organizationId) throw new BadRequestException()
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const existing = await this.repo.findBySlug(slug, scope.organizationId)
  if (existing) throw new BadRequestException('name in use')
  return await this.db.transaction(async (query) => {
    const [project] = await query<Project>(`INSERT INTO ...`, [...])
    if (input.source.kind === 'database') {
      await query(`INSERT INTO project_data_sources (..., db_url) VALUES ($1, ..., $5)`, [...])
    } else if (input.source.kind === 'airweave_collection') {
      await query(`INSERT INTO project_data_sources (..., collection_id) VALUES ($1, ..., $5)`, [...])
    } else {
      await query(`INSERT INTO project_data_sources (..., url) VALUES ($1, ..., $5)`, [...])
    }
    return project
  })
}
```

### Refactor: each step is a named method

```ts
// ✅ Top-level reads like a checklist; each step has a single, testable purpose
async createProjectWithSource(input: CreateProjectInput, scope: OrgScope): Promise<Project> {
  this.assertOrgScope(scope)
  const slug = this.toSlug(input.name)
  await this.assertSlugAvailable(slug, scope.organizationId)

  return this.db.transaction(async (query) => {
    const project = await this.insertProject(query, input, slug, scope.organizationId)
    await this.insertSource(query, project.id, input.source)
    return project
  })
}
```

Each `insertSource`/`assertSlugAvailable`/etc. is a small, focused method. The orchestration method is now ~6 lines.

## Tactic 5: Replace boolean flag with separate functions

A function with a `boolean` parameter that branches its entire body is two functions wearing one signature.

```ts
// ❌ Caller has to remember which boolean to pass
async findProject(id: string, includeArchived: boolean): Promise<Project> {
  if (includeArchived) {
    return await this.repo.findByIdIncludingArchived(id)
  }
  return await this.repo.findActive(id)
}

// ✅ Two functions, two clear names
async findActiveProject(id: string): Promise<Project> { return this.repo.findActive(id) }
async findProjectIncludingArchived(id: string): Promise<Project> { return this.repo.findByIdIncludingArchived(id) }
```

Exception: the boolean genuinely toggles a small detail (e.g., a logging flag) — leave it.

## Tactic 6: Replace conditional with polymorphism (use rarely)

When a function branches on a discriminant (`source.kind`), and each branch is non-trivial, replace with a registry/strategy:

```ts
// ❌ Long switch on .kind, each arm doing different work
switch (source.kind) {
  case 'database':           return await this.searchDatabase(source.config, query)
  case 'airweave_collection': return await this.searchAirweave(source.config, query)
  case 'external':           return await this.searchExternal(source.config, query)
}

// ✅ Registry dispatches; each provider implements the interface
return await this.registry.search(source, query)  // see DataSourceRegistry
```

This codebase already has `DataSourceRegistry` — prefer it. Don't introduce a new strategy registry just to break up a 3-arm switch unless the arms are growing.

## Common LLM mistakes (catch these in `code-reviewer`)

1. **Nested validation pyramid** — three+ levels of `if` checking preconditions before the work. → Use guard clauses with early throw.
2. **`else` after `return`/`throw`** — vestigial branch. → Remove the `else`; flatten.
3. **Nested ternaries** — already forbidden by `code-simplifier`. → Replace with `if` cascade or named function.
4. **God method orchestrating five unnamed sections** — each section is a step with a name; extract.
5. **Boolean flag changing the function's whole behavior** — split into two functions.
6. **Switch over `.kind` repeated in multiple methods** — use a registry/strategy (this repo's `DataSourceRegistry` is the model).
7. **Single early-return for the unhappy path, then deeply nested happy path** — half-applied tactic. Apply early returns to all preconditions.
8. **Refactoring for the metric without improving readability** — splitting a clear 6-line function into two 3-line functions named `step1` and `step2`. Don't do this.

## Hard rules

- MUST eliminate `else` after `return`/`throw`.
- MUST replace nested ternaries (per `code-simplifier`).
- MUST use guard clauses for preconditions; happy path at the bottom of the function.
- MUST NOT refactor solely to lower the metric without improving readability.
- MUST NOT introduce abstractions for one-off duplication (per CLAUDE.md design-review YAGNI).

## Cross-references

- `code-simplifier` — prohibits nested ternaries; pairs with this skill for cleanup passes.
- `design-review` — KISS, SoC, "minimal setup" rubric.
- `repo-conventions` — naming conventions for extracted methods (avoid `Manager`/`Helper`/`Util`).
- `tdd-workflow` — refactoring stays in scope; tests stay green.
