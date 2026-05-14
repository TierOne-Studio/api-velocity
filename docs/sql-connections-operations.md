# SQL Connections — Operations Runbook

How to operate the chat-to-SQL agent path safely. Pairs with [ADR-0001](./adr/0001-app-agent-data-plane-soc.md), which captures the architectural decision; this file is the operational consequence of that decision.

For master-key rotation specifically, see [`sql-connections-key-rotation.md`](./sql-connections-key-rotation.md).

---

## What this runbook covers

The code can enforce **data plane separation at the process level** (different `DataSource`, different pool, different lifetime) and **dial-time host validation** (SSRF denylist, app-DB blocklist). It cannot enforce:

- The network the attached DB lives on.
- The Postgres role the connection uses.
- Row-level access controls inside the attached DB.

Those are operational invariants. This document is how to set them up.

---

## 1. Network segmentation

**Recommendation:** user-attachable databases SHOULD live on a different network segment from the application database.

Even with the same-host guard (`AGENT_FORBIDDEN_DATABASES`, see [config.service.ts](../src/shared/config/config.service.ts)) and the SSRF denylist (RFC1918 / loopback / link-local / cloud-metadata), defense in depth means the agent path shouldn't even be **routable** to the internal services that hold app secrets, auth state, or shared infrastructure.

Concrete patterns:

| Topology | Verdict |
|---|---|
| App DB and attached DB in the same VPC, same subnet | ⚠️ Same-host guard is the only defense |
| App DB and attached DB in the same VPC, different subnets, NACL between them | ✅ Acceptable |
| App DB in private VPC; attached DBs reachable only via public endpoints (TLS) | ✅ Best |
| Attached DB on the cloud-provider metadata network | ❌ Blocked by SSRF guard, but config shouldn't even allow attempting it |

The application's runtime egress should be filtered to the set of endpoints the agent is allowed to dial. If your platform supports egress allowlists (Cloudflare Workers, K8s NetworkPolicy, AWS Security Groups), use them.

---

## 2. Least-privilege Postgres role on the attached DB

**Required** for any attached connection used in production.

The application's `SET TRANSACTION READ ONLY` is the belt. The connecting role's permissions are the suspenders. Together they make a write physically impossible. With only one, a future bug, a future LangChain refactor, or a future validator gap is enough to lose the property.

### Minimum role definition

```sql
-- On the ATTACHED database, run as a superuser or owner:

CREATE ROLE chat_reader WITH
  LOGIN
  PASSWORD '<random 32+ chars>'
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  CONNECTION LIMIT 5;

-- Read-only on the tables you want exposed:
GRANT CONNECT ON DATABASE your_db TO chat_reader;
GRANT USAGE ON SCHEMA public TO chat_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO chat_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO chat_reader;

-- Belt + suspenders + a third strap: revoke EXECUTE on functions that
-- could let a privilege-escalation reach the filesystem or network.
-- The validator already denies these via deny-words, but role-level
-- revocation is the authoritative defense:
REVOKE EXECUTE ON FUNCTION pg_read_file FROM chat_reader;
REVOKE EXECUTE ON FUNCTION pg_read_binary_file FROM chat_reader;
REVOKE EXECUTE ON FUNCTION lo_import FROM chat_reader;
REVOKE EXECUTE ON FUNCTION lo_export FROM chat_reader;
REVOKE EXECUTE ON FUNCTION pg_terminate_backend FROM chat_reader;
REVOKE EXECUTE ON FUNCTION pg_cancel_backend FROM chat_reader;

-- If dblink / postgres_fdw extensions are present in your DB but
-- unused by the chat path, revoke or drop them:
REVOKE EXECUTE ON FUNCTION dblink_exec FROM chat_reader;
REVOKE EXECUTE ON FUNCTION dblink FROM chat_reader;
```

### Why not use the existing app role?

Because the existing app role can write. Even if every layer above it is correctly read-only, an attacker who finds a way to reach `pg_query` directly (via a future LangChain feature, a tool with a different shape, etc.) inherits the role's full permissions. A separate `chat_reader` role makes the worst-case **structurally** bounded.

---

## 3. Row-Level Security (RLS)

If the attached DB holds **multi-tenant** data (e.g. one table that holds rows for many customers), the `chat_reader` role's `SELECT` grants are not enough. Without RLS, an org member can ask "how many users do we have across all tenants?" and the agent will happily count rows the org has no business seeing.

The pattern:

```sql
ALTER TABLE multi_tenant_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_reader_tenant_scope ON multi_tenant_orders
  FOR SELECT
  TO chat_reader
  USING (tenant_id = current_setting('app.tenant_id')::int);

-- The application then sets the tenant_id per-request before issuing
-- the query. The SqlToolkit doesn't currently set session GUCs — this
-- is a future enhancement; for now, RLS is an option only for
-- single-tenant attached DBs.
```

**Current limitation:** the chat-to-SQL path does not propagate the org/tenant context into Postgres session variables, so RLS policies that depend on `current_setting('app.tenant_id')` won't fire. Either:

1. Use RLS with a **fixed `USING` clause** that's intrinsic to the table (e.g. `WHERE deleted_at IS NULL` for soft-delete), or
2. Keep the attached DB single-tenant and rely on the `chat_reader` grants alone, or
3. Use a per-org **per-DB-user** mapping (advanced; track each org as a different Postgres user and grant per-user).

A future ADR will add session-variable propagation for full RLS support.

---

## 4. Per-connection table allowlist

In addition to the role's grants, each `sql_connection` row carries an optional `allowed_tables` JSONB column ([H1 of the PR review](../../docs/sql-connections-key-rotation.md)):

- **`null`** → no allowlist; the sub-agent's `list_tables_sql_db` returns every table the role can see.
- **Array of identifiers** → the SqlToolkit's introspection only sees these tables. Both unqualified (`"users"`) and schema-qualified (`"analytics.orders"`) entries are accepted. Postgres identifier-shape validation runs at create / update time.

When deciding what to allow:

- Prefer the **smallest set** that still answers the questions the chat is expected to handle.
- If the role's grants are already tight (only the necessary tables), `allowed_tables = null` is acceptable.
- If the role has broader grants (e.g. read access to an entire schema), use `allowed_tables` to narrow further — the allowlist is per-connection, the role grant is shared across all connections that authenticate as that role.

The allowlist is enforced at the **sub-agent introspection layer**: tables outside the allowlist don't appear in `list_tables_sql_db` and `info_sql_db` results, so the LLM never even sees them. Combined with the role's lack of `SELECT` grants, this is two independent defenses.

---

## 5. `AGENT_FORBIDDEN_DATABASES` configuration

The application **always** blocks dialing the canonical app database from the agent path. The env var controls additional endpoints:

- **Unset**: defaults to `[DATABASE_URL]`.
- **Set**: a comma-separated list of Postgres URLs. The app's `DATABASE_URL` is NOT included automatically when this env is set — list it explicitly.

Use cases for a non-default value:

| Topology | Set `AGENT_FORBIDDEN_DATABASES` to |
|---|---|
| Single app DB (default) | leave unset; defaults to `[DATABASE_URL]` |
| Primary + replica | `<primary_url>,<replica_url>` |
| Multiple app instances on a shared cluster | URL of every instance + cluster's admin endpoint |
| Internal services that happen to expose Postgres-compatible endpoints | their URLs + the app's |

Hostnames are matched at **host + port** granularity (not database name). A sibling DB on the same cluster — `postgres://...@10.0.1.5:5432/audit_log` when the app is `postgres://...@10.0.1.5:5432/app` — is blocked even though the database name differs. This prevents `dblink` / `postgres_fdw` chains.

A malformed URL in the list **fails closed**: the factory refuses to dial *any* host until the typo is fixed. This is intentional — a security check that silently degrades on bad input is worse than no check.

---

## 6. Verification checklist (before exposing a new attached DB to chat)

- [ ] Network: attached DB lives on a different segment from the app DB, or the egress allowlist permits only the attached DB's host.
- [ ] Role: connection uses a `chat_reader` (or equivalent) least-privilege role with `SELECT`-only grants.
- [ ] Role: `REVOKE EXECUTE` on `pg_read_file`, `pg_read_binary_file`, `lo_import`, `lo_export`, `dblink`, `dblink_exec` (the validator's deny-list functions).
- [ ] Allowlist: `allowed_tables` set to the smallest useful subset, OR confirmed acceptable that the role grants are themselves narrow.
- [ ] RLS (if applicable): policies in place for any multi-tenant table the role can `SELECT`.
- [ ] Connection tested via `/test`: returns `{ ok: true }` before saving.
- [ ] `AGENT_FORBIDDEN_DATABASES` reviewed for completeness (include every internal Postgres endpoint, not just the primary app DB).

---

## 7. Incident response

If the chat agent surfaces data it shouldn't have reached:

1. **Disable the connection immediately**: set `status = 'error'` via the admin UI or directly in `org_sql_connection`. The chat agent skips connections with `status != 'ready'`.
2. **Audit the SQL log**: the assistant message metadata persists `sqlCalls[]` (connection id, SQL text, row count, durationMs — no rows). Trace what the agent ran.
3. **Tighten the role**: revoke the relevant `SELECT` grants on the attached DB.
4. **Tighten the allowlist**: shrink `allowed_tables` to exclude the surface.
5. **Investigate validator gap**: if the SQL itself shouldn't have passed the validator, file an issue with the captured `sql` field; add to `DENY_WORDS` / regex.
6. **Rotate `PROJECT_SOURCE_SECRET_KEY`** if the leak suggests stored-credential compromise (see [key-rotation.md](./sql-connections-key-rotation.md)).

---

## Related references

- [`docs/adr/0001-app-agent-data-plane-soc.md`](./adr/0001-app-agent-data-plane-soc.md) — the architectural decision.
- [`docs/sql-connections-key-rotation.md`](./sql-connections-key-rotation.md) — master-key rotation playbook.
- [`src/shared/security/host-validator.ts`](../src/shared/security/host-validator.ts) — SSRF guard implementation.
- [`src/modules/projects/application/providers/database/sql-validator.ts`](../src/modules/projects/application/providers/database/sql-validator.ts) — SQL deny-list / read-only enforcement.
- [`src/modules/projects/application/providers/database/sql-datasource.factory.ts`](../src/modules/projects/application/providers/database/sql-datasource.factory.ts) — agent-time DataSource factory with the forbidden-DB guard.
