---
name: db-write-protocol
description: Use when ANY database write is required — INSERT, UPDATE, DELETE, schema change, migration, destructive maintenance. NOT for SELECT, read-only investigations, JQL queries, or schema introspection.
---

# Database Write Protocol

DB writes need explicit user approval. **Some** catastrophic destructive SQL patterns are also denied at the tool boundary by `.claude/settings.json` `permissions.deny` — but coverage is not exhaustive across every keyword and every client. Treat `permissions.deny` as a safety net for the obvious cases, not as a complete fence. This skill is the workflow on top of those gates.

The deny list as of this commit covers (broadly):
- `mysql` / `psql`: `DELETE`, `DROP`, `TRUNCATE`, `UPDATE`, `INSERT`, `ALTER`, `CREATE`, `REPLACE` (mysql only), `GRANT`, `REVOKE`, `RENAME` (mysql only)
- `sqlite3`: `DELETE`, `DROP`, `TRUNCATE`, `UPDATE`, `INSERT`, `ALTER`, `CREATE`, `REPLACE`
- `mysqldump`, `pg_restore` blocked entirely.

Don't rely on this list to catch every destructive command — some clients (`pgcli`, `mycli`, ORM CLIs) and some keyword variants will slip through. The approval workflow below is the load-bearing safety.

## Three-step protocol (mandatory)

1. **Show the exact SQL** that will run. Not a description — the literal statement(s).
2. **Explain impact** (see analysis fields below).
3. **WAIT** for explicit approval. Then run.

## Impact analysis fields

For every write, present:

```
Tables:        <name(s)>
Rows affected: <run COUNT(*) for the WHERE clause first; cite the number>
WHERE clause:  <restate it; flag if missing or overly broad>
Reversibility: <can this be undone? how? backup taken?>
Cascading:     <foreign keys, triggers, materialized views, audit logs>
Production:    <is this prod? what's the user-visible impact during the write?>
```

If you cannot answer any field, stop and gather the info before asking for approval.

## Approval keywords

**Explicit only:** `approve`, `yes`, `go ahead`, `proceed`.
**NOT acceptable:** `ok`, `looks fine`, `sure`, `sounds good`, silence, thumbs up emoji.

If the user's reply is ambiguous, ask again with the exact phrasing required.

## Migration-specific extensions

For schema changes / data migrations:

- **Up + down both required.** Provide the rollback before asking for approval.
- **Table state:** row count, indexes, constraints, locks held.
- **Large-table warning:** for tables > ~1M rows, warn about lock duration. Prefer online schema-change tools (`pt-online-schema-change`, `gh-ost`) where appropriate.
- **Deploy ordering:** schema vs. application code — explicit which goes first and why.

## Non-interactive / scripted runs

There is no shell-level pre-authorization mechanism for database writes in this repo. CI or scripted execution follows the same standard as interactive use:

- show the exact SQL,
- explain the impact (using the fields above),
- obtain explicit user approval in the current task before running.

Do not rely on environment variables, shell configuration, or out-of-band approval to authorize a write.

## Anti-patterns

- Running an `UPDATE` without a `WHERE` clause "to test the syntax".
- Running `DELETE` and `then` checking `SELECT COUNT(*)` to see what got deleted.
- Treating "ok" as approval.
- Skipping the down migration "because it's a one-way change".
- Migration in production at peak hours without an explicit window.
