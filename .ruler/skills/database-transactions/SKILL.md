---
name: database-transactions
description: Use when implementing or reviewing multi-statement database operations — INSERT/UPDATE/DELETE across multiple rows or tables, read-then-write patterns, or any business operation that must be atomic. NOT for single-statement reads, single-statement writes against one row, or pure SELECT investigations.
---

# Database Transactions

This codebase uses two persistence APIs (per `repo-conventions` § 4): TypeORM (default for new modules, established in RBAC) and raw SQL via `DatabaseService` (existing modules and justified TypeORM-can't cases). Each has its own transaction API. Neither auto-wraps multi-statement business operations for you — you must reach for the matching transaction helper. LLMs reliably forget this when the code "looks like it works in tests."

## When this fires

- Two or more `INSERT`/`UPDATE`/`DELETE` statements that must succeed together.
- Read-then-write patterns (`SELECT ... FOR UPDATE` then `UPDATE`).
- Cross-table operations (writing to `projects` and `project_data_sources` together).
- Operations where partial completion would leave the system inconsistent.
- Any code path where a thrown error after one write but before another would leave bad state.

## When this does NOT fire

- A single `INSERT`, `UPDATE`, or `DELETE` against one row. The DB handles atomicity.
- A single `SELECT` (read-only).
- Operations where each step is independently consistent (e.g., audit log writes that are best-effort).

## Migration code: NOT auto-wrapped — verify before assuming atomicity

**Important correction:** the migration runner in this repo (`DatabaseService.runMigrations()` and the per-domain `*.migration.ts` files driven by `OnModuleInit`) does **NOT** wrap each migration in a transaction. Each migration calls `this.query(...)` (or `this.db.query(...)`) directly, then separately records itself via `recordMigration(name)`. If the schema change succeeds but `recordMigration` fails (or vice versa), you get an inconsistent state.

When writing a new migration:

- If the migration runs multiple statements that must be atomic (multiple `CREATE TABLE` / `ALTER` / data-backfill steps), **wrap them yourself** using `db.transaction(async (query) => { ... })`.
- If the migration is a single statement, atomicity is handled by the DB and an explicit transaction is unnecessary.
- Be aware that the migration record itself (`INSERT INTO _migrations`) is a separate query outside any transaction you write — a partial-success window exists. For most schema-creation migrations this is acceptable (a re-run will detect the existing table); for data-backfill migrations, design idempotently.

## Two transaction APIs (match the repository style)

Per `repo-conventions`, TypeORM is the default for new modules and raw SQL via `DatabaseService` is the fallback for existing modules and justified TypeORM-can't cases. Each has its own transaction API; use the one that matches the repository style of the code you're writing.

### TypeORM transactions (default for new modules)

For TypeORM-based repositories, use `manager.transaction(...)` via the `DataSource` or via an entity repository's `manager`:

```ts
// Inside a service that owns the transaction boundary
constructor(
  @InjectDataSource() private readonly dataSource: DataSource,
) {}

async createWithSetup(input: CreateInput, organizationId: string): Promise<Role> {
  return await this.dataSource.transaction(async (manager) => {
    const roleRepo = manager.getRepository(RoleTypeOrmEntity)
    const role = await roleRepo.save({
      ...input,
      organizationId,            // belt + suspenders, even inside the transaction
    })

    const permRepo = manager.getRepository(PermissionTypeOrmEntity)
    await permRepo.save(
      input.permissions.map(p => ({ ...p, roleId: role.id, organizationId })),
    )

    return toDomain(role)
  })
}
```

The `manager` parameter is a transactional `EntityManager`. **Use it for all queries inside the callback** — calls on the original `@InjectRepository` repository go to a non-transactional connection. Same pitfall as the raw-SQL `this.db.query` mistake below.

You can also reach `manager` via an injected repository:
```ts
return await this.roleRepo.manager.transaction(async (manager) => { ... })
```

### Raw-SQL transactions (existing modules + justified fallback)

`DatabaseService.transaction<T>(callback)` is defined at [database.module.ts:60-85](src/shared/infrastructure/database/database.module.ts:60). It does the right thing: `BEGIN`, runs the callback with a transactional `query` function, `COMMIT` on success, `ROLLBACK` on throw, releases the client in `finally`.

```ts
const result = await this.db.transaction(async (query) => {
  const [project] = await query<Project>(
    `INSERT INTO projects (name, organization_id) VALUES ($1, $2) RETURNING *`,
    [input.name, organizationId],
  )

  await query(
    `INSERT INTO project_data_sources (project_id, kind, config) VALUES ($1, $2, $3)`,
    [project.id, input.source.kind, input.source.config],
  )

  return project
})
```

**Use the callback's `query` function**, not `this.db.query`. The `this.db.query` calls go to a different connection from the pool — they're outside the transaction. This is the most common mistake and the worst kind: silently incorrect.

```ts
// ❌ this.db.query goes to a different pool connection — NOT inside the transaction
await this.db.transaction(async (query) => {
  await query(`INSERT INTO a ...`)        // transactional ✓
  await this.db.query(`INSERT INTO b ...`) // NOT transactional ✗ — survives a rollback
})
```

## Decision tree

```
Q1: Single statement, single row?
    YES → No transaction needed. Just call this.db.query(...).
    NO  → Q2

Q2: Multiple statements OR multiple rows OR cross-table?
    YES → Wrap in this.db.transaction(async (query) => { ... }).
    NO  → reconsider Q1; you probably have a single statement.

Q3 (inside a transaction): Does the work include an external HTTP call?
    YES → STOP. Restructure. Never hold a DB transaction open across external I/O.
    NO  → Continue.
```

## Hard rules

1. **Never hold a transaction across external I/O.** HTTP calls, queue publishes, Stripe API calls — none of these belong inside a `transaction(...)` callback. The pool connection is locked while the transaction runs; an external call slow path becomes a connection-pool exhaustion incident.

2. **Always include `WHERE organization_id = $X`** in transactional writes too — the transaction doesn't replace the RBAC scoping rule from `repo-conventions`. Belt + suspenders applies inside transactions and outside them.

3. **Use `RETURNING *` (or `RETURNING <cols>`) instead of round-tripping.** Inside a transaction, the inserted/updated row is visible to subsequent queries on the same connection — but explicitly returning the row from the same statement is cleaner and one fewer round-trip.

4. **Don't catch inside the transaction callback to swallow errors.** A caught error means the rollback doesn't happen. Let it propagate; the helper rolls back and re-throws.

```ts
// ❌ Caught error → no rollback, partial state committed
await this.db.transaction(async (query) => {
  await query(`INSERT INTO a ...`)
  try {
    await query(`INSERT INTO b ...`)  // fails
  } catch (e) {
    this.logger.warn('b failed, continuing')  // a is committed; b is silently lost
  }
})
```

5. **Don't nest transactions.** Postgres supports savepoints, but the helper here doesn't expose them. If you find yourself wanting nested transactions, the operation probably should be flattened or split.

## Isolation levels

The default in Postgres is `READ COMMITTED`. The repo's helper uses the default. For most multi-step writes, `READ COMMITTED` is correct. Reach for higher isolation only when:

- **`REPEATABLE READ`** — you do multiple SELECTs in the transaction and need consistent reads (no phantom rows).
- **`SERIALIZABLE`** — you have read-modify-write patterns where two concurrent transactions could each commit valid-in-isolation but invalid-in-aggregate (e.g., "ensure no more than 5 admins per org" with two simultaneous promotions).

To set isolation per-transaction (the helper doesn't expose this directly today, so you'd run `SET TRANSACTION ISOLATION LEVEL ...` as the first query in the callback):

```ts
await this.db.transaction(async (query) => {
  await query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')
  // ... rest of the work
})
```

`SERIALIZABLE` can fail with SQLSTATE 40001 (`could not serialize access due to concurrent update`). Surface this to the caller (not retry silently — per CLAUDE.md P5). The caller can choose to retry the user's action.

## Common LLM mistakes (catch these in `code-reviewer`)

These apply to **both** TypeORM and raw-SQL transactions unless noted.

1. **No transaction at all** — multi-step write without wrapping. This is the #1 mistake, regardless of API.
2. **Using the non-transactional handle inside the callback:**
   - Raw SQL: `this.db.query(...)` inside `db.transaction(async (query) => { ... })` bypasses the transaction.
   - TypeORM: `this.roleRepo.save(...)` inside `dataSource.transaction(async (manager) => { ... })` bypasses the transaction. Use `manager.getRepository(...)` instead.
3. **External HTTP/queue call inside the callback** — locks a pool connection during external I/O. Same hard rule for both APIs.
4. **Catching errors inside the callback** — defeats the rollback. Both APIs depend on the callback throwing for rollback to fire.
5. **Missing `where: { organizationId }` (TypeORM) or `WHERE organization_id` (raw SQL)** — RBAC scoping doesn't disappear inside a transaction.
6. **Reading before writing without explicit locking:**
   - TypeORM: use `manager.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } })`.
   - Raw SQL: use `SELECT ... FOR UPDATE`.
7. **Mixing the two APIs in the same callback** — a TypeORM transaction's `manager` and the raw-SQL `query` parameter are not interchangeable. Pick one API per transaction.
8. **Wrapping a single statement in a transaction** — over-engineering. The DB makes single statements atomic.

## Repo-fit examples

- **RBAC role + permissions creation** (TypeORM module) — `dataSource.transaction(async (manager) => { ... })` to insert role + permission rows atomically.
- **Project + data-source creation** (`ProjectsService.create`, raw-SQL module) — `db.transaction(async (query) => { ... })` to insert into `projects` then `project_data_sources`. A failure on the second insert without a transaction would leave an orphan project.
- **Status transitions with side-effects in the DB** — e.g., marking a project source `ready` AND updating the project's overall status. Atomic, raw-SQL.
- **Migrations** — NOT auto-wrapped (see "Migration code" section above). For multi-statement migrations, wrap explicitly using whichever API matches the migration's style.

## Cross-references

- [database.module.ts:60](src/shared/infrastructure/database/database.module.ts:60) — the `transaction<T>(callback)` helper.
- `repo-conventions` § "Repository pattern" — raw SQL conventions, parameterization rules.
- `db-write-protocol` — approval flow for any DB write. Transactions don't bypass approval.
- `async-error-handling` — error propagation; the transaction helper relies on the callback throwing.
- `failure-mode-analysis` — `partial` and `race` categories map to the transaction concerns above.
