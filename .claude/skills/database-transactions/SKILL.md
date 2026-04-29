---
name: database-transactions
description: Use when implementing or reviewing multi-statement database operations — INSERT/UPDATE/DELETE across multiple rows or tables, read-then-write patterns, or any business operation that must be atomic. NOT for single-statement reads, single-statement writes against one row, or pure SELECT investigations.
---

# Database Transactions

This codebase uses raw SQL via `DatabaseService` — there is no ORM hiding transactions for you. Multi-statement business operations need explicit transaction wrapping, or partial-write states will leak into production. LLMs reliably forget this when the code "looks like it works in tests."

## When this fires

- Two or more `INSERT`/`UPDATE`/`DELETE` statements that must succeed together.
- Read-then-write patterns (`SELECT ... FOR UPDATE` then `UPDATE`).
- Cross-table operations (writing to `projects` and `project_data_sources` together).
- Operations where partial completion would leave the system inconsistent.
- Any code path where a thrown error after one write but before another would leave bad state.

## When this does NOT fire

- A single `INSERT`, `UPDATE`, or `DELETE` against one row. The DB handles atomicity.
- A single `SELECT` (read-only).
- Migration code (the migration framework wraps each migration in its own transaction).
- Operations where each step is independently consistent (e.g., audit log writes that are best-effort).

## The repo's transaction API

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

1. **No transaction at all** — multi-step write without `db.transaction(...)`. This is the #1 mistake.
2. **Using `this.db.query` inside the callback** — bypasses the transaction entirely.
3. **External HTTP/queue call inside the callback** — locks a pool connection during external I/O.
4. **Catching errors inside the callback** — defeats the rollback.
5. **Missing `WHERE organization_id`** — RBAC scoping doesn't disappear inside a transaction.
6. **Reading before writing without explicit locking** — `SELECT` then `UPDATE` without `FOR UPDATE` is a classic race condition.
7. **Returning the result of a `RETURNING` clause but typing it loosely** — `query<Project>(...)` should be the typed row shape.
8. **Wrapping a single statement in a transaction** — over-engineering. The DB already makes single statements atomic.

## Repo-fit examples

- **Project + data-source creation** (`ProjectsService.create`) — should be transactional: insert into `projects`, then insert into `project_data_sources`. A failure on the second insert today (without transaction) would leave an orphan project.
- **RBAC permission grant** — if granting a role involves writing to multiple junction tables, that's transactional.
- **Status transitions with side-effects in the DB** — e.g., marking a project source `ready` AND updating the project's overall status. Atomic.
- **Migrations** — already wrapped by the migration runner. Don't wrap again.

## Cross-references

- [database.module.ts:60](src/shared/infrastructure/database/database.module.ts:60) — the `transaction<T>(callback)` helper.
- `repo-conventions` § "Repository pattern" — raw SQL conventions, parameterization rules.
- `db-write-protocol` — approval flow for any DB write. Transactions don't bypass approval.
- `async-error-handling` — error propagation; the transaction helper relies on the callback throwing.
- `failure-mode-analysis` — `partial` and `race` categories map to the transaction concerns above.
