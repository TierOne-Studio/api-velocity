# SQL Connections — Operations Runbook

How to operate the chat-to-SQL agent path safely. Pairs with [ADR-010](./decisions/ADR-010-supersede-app-db-host-guard.md) (current) and [ADR-0001](./adr/0001-app-agent-data-plane-soc.md) (superseded — kept for history); this file is the operational consequence of those decisions.

For master-key rotation specifically, see [`sql-connections-key-rotation.md`](./sql-connections-key-rotation.md).

---

## What this runbook covers

The code can enforce **data plane separation at the process level** (different `DataSource`, different pool, different lifetime) and **dial-time SSRF host validation** (RFC1918 / loopback / link-local / cloud-metadata denylist). It cannot enforce:

- The network the attached DB lives on.
- The Postgres role the connection uses.
- Row-level access controls inside the attached DB.

Those are operational invariants. This document is how to set them up.

> **Important change:** the code-level host+port forbidden-app-DB guard (`AGENT_FORBIDDEN_DATABASES`) was removed in ADR-010. The chat-to-SQL agent **can now dial the same Postgres host:port as the application database** — including the application's own DB. The read-only contract is enforced by (1) the SQL validator's instance-metadata deny-list, (2) `SET TRANSACTION READ ONLY` on every query, and (3) operator-provisioned `SELECT`-only Postgres role grants (§ 2 below). If you want host-level segregation, enforce it at the **network layer** (VPC / security group / egress allowlist) per § 1.

---

## 1. Network segmentation

**Recommendation:** user-attachable databases SHOULD live on a different network segment from the application database — unless you have explicitly decided to point the agent at the app DB itself with a `SELECT`-only role.

The SSRF denylist (RFC1918 / loopback / link-local / cloud-metadata) is the only code-level dial-time host check after ADR-010; the host+port app-DB guard is gone. Defense in depth means the agent path shouldn't be **routable** to the internal services that hold app secrets, auth state, or shared infrastructure — that's enforced at the network layer now, not in code.

Concrete patterns:

| Topology | Verdict |
|---|---|
| App DB and attached DB in the same VPC, same subnet, no egress allowlist | ⚠️ Only the role grants + SQL validator stand between the agent and the app DB |
| App DB and attached DB in the same VPC, different subnets, NACL / security group between them | ✅ Acceptable |
| App DB in private VPC; attached DBs reachable only via public endpoints (TLS) | ✅ Best |
| Attached DB on the cloud-provider metadata network | ❌ Blocked by SSRF guard, but config shouldn't even allow attempting it |
| Agent dials the application's own DB via a `chat_app_reader` role (publicly reachable host) | ✅ Acceptable iff the role grants are tight per § 5 (note: app-DB schema typically contains auth/session tables that MUST be REVOKE'd) |

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

## 5. Migration: `AGENT_FORBIDDEN_DATABASES` was removed

**Removed in ADR-010.** The host+port forbidden-app-DB guard (`checkForbiddenAppDatabase` / `assertNotAppDatabase` in `sql-datasource.factory.ts`, fed by `getAgentForbiddenDatabases()` in `config.service.ts`) no longer exists. The env var `AGENT_FORBIDDEN_DATABASES` is **no longer read** by the application.

### What replaces it

| Old defense | New defense |
|---|---|
| Refuse to dial when conn `host:port` matches `AGENT_FORBIDDEN_DATABASES` | Postgres role grants on the agent's connection (§ 2 above) |
| Sibling-DB block (same instance, different DB name) via `dblink` concern | Validator's `DBLINK`/`DBLINK_EXEC`/`POSTGRES_FDW_*`/instance-catalog deny-list (`sql-validator.ts`) + `SET TRANSACTION READ ONLY` chokepoint |
| Defense against accidentally pointing the agent at the app DB | None at the code level — point the agent at any reachable Postgres now, and rely on § 2's role + § 1's network segmentation |

### Operator migration checklist

- [ ] Remove `AGENT_FORBIDDEN_DATABASES` from your environment (the application no longer reads it; leaving it set is a no-op).
- [ ] Confirm every `sql_connection` row used in production points at a `chat_reader`-style least-privilege role per § 2. The app's own DB role MUST NOT be used for chat — even if the app DB is the only Postgres available, provision a separate role with `SELECT`-only grants.
- [ ] If you previously relied on the code guard to prevent operators from misconfiguring a connection at the app DB, replace that with a deploy-time check (CI lint, IAM policy, secrets-manager rule) — not application logic.
- [ ] Audit egress at the network layer (§ 1). The agent no longer refuses dials at the app DB; the host firewall is the line of defense.

### Pointing the agent at the application's own DB intentionally

This is now supported but **requires deliberate role setup** — the app DB contains auth tokens, sessions, and the encrypted credentials for every other attached connection. A naive `GRANT SELECT ON ALL TABLES IN SCHEMA public` exposes all of them.

> ⚠️ **Critical:** the example below is for the api-velocity TypeORM schema where `public` holds `users`, `auth_token`, `session`, `org_sql_connection`, `role`, `permission`, `role_permission`, and other auth tables. **Edit the `REVOKE` list to match YOUR schema before running.** If you don't know which tables hold credentials/sessions/PII, do not run the wildcard `GRANT`; instead, list every table the agent is allowed to read explicitly with `GRANT SELECT ON specific_table TO chat_app_reader`.

```sql
-- On the application's own database, run as a superuser or app owner:

CREATE ROLE chat_app_reader WITH
  LOGIN
  PASSWORD '<random 32+ chars>'
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  CONNECTION LIMIT 5;

-- 1. Baseline grants on the schema you want exposed.
GRANT CONNECT ON DATABASE app TO chat_app_reader;
GRANT USAGE ON SCHEMA public TO chat_app_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO chat_app_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO chat_app_reader;

-- 2. REVOKE on app-secrets tables. Add every table in YOUR app DB that
-- holds credentials, tokens, sessions, encrypted secrets, or PII you
-- don't want the chat agent to see. The list below is api-velocity's
-- default schema — adjust to your migrations.
REVOKE SELECT ON
  public.user,
  public.auth_token,
  public.session,
  public.org_sql_connection,
  public.role,
  public.permission,
  public.role_permission,
  public.org_user_role,
  public.organization
FROM chat_app_reader;

-- 3. REVOKE EXECUTE on filesystem / network / privileged functions. The
-- validator already denies these via deny-words; role-level revocation
-- is the authoritative defense if the validator ever regresses.
REVOKE EXECUTE ON FUNCTION pg_read_file FROM chat_app_reader;
REVOKE EXECUTE ON FUNCTION pg_read_binary_file FROM chat_app_reader;
REVOKE EXECUTE ON FUNCTION lo_import FROM chat_app_reader;
REVOKE EXECUTE ON FUNCTION lo_export FROM chat_app_reader;
REVOKE EXECUTE ON FUNCTION pg_terminate_backend FROM chat_app_reader;
REVOKE EXECUTE ON FUNCTION pg_cancel_backend FROM chat_app_reader;
REVOKE EXECUTE ON FUNCTION dblink FROM chat_app_reader;
REVOKE EXECUTE ON FUNCTION dblink_exec FROM chat_app_reader;

-- 4. REVOKE SELECT on instance-metadata system catalogs. This list MUST
-- track the instance-metadata DENY_WORDS in `sql-validator.ts` (Slice 1
-- of ADR-010). If you add a catalog to the validator deny-list, mirror
-- it here so the role-grant suspenders match the validator's belt.
REVOKE SELECT ON
  pg_catalog.pg_shadow,
  pg_catalog.pg_authid,
  pg_catalog.pg_roles,
  pg_catalog.pg_user,
  pg_catalog.pg_stat_activity,
  pg_catalog.pg_stat_replication,
  pg_catalog.pg_settings,
  pg_catalog.pg_hba_file_rules,
  pg_catalog.pg_file_settings,
  pg_catalog.pg_replication_slots,
  pg_catalog.pg_subscription,
  pg_catalog.pg_publication
FROM chat_app_reader;
```

After running this, attach via the admin UI as a normal `sql_connection`, pointing at the same host/port as `DATABASE_URL` but using `chat_app_reader`'s credentials. The SSRF guard will allow the dial iff the host is publicly reachable (not RFC1918 / loopback / link-local / cloud-metadata).

> 🚫 **Private-VPC topologies are NOT supported by this path today.** If your `DATABASE_URL` resolves to an RFC1918 IP (typical for AWS RDS in a private VPC without `PubliclyAccessible=true`), the SSRF guard will block the dial and the chat agent will return `connection_failed`. Options: (1) make the app DB endpoint publicly reachable behind TLS; (2) front the app DB with an internal NLB that has a routable IP; (3) wait for the SSRF-allowlist follow-up (ADR-010 Follow-ups, not yet implemented).

### Operator-misconfiguration tripwire

ADR-010 added a structured audit log on every agent dial:

```
[Nest] [SqlDataSourceFactory] [agent.dial] connectionId=<id> host=<host> port=<port> database=<db>
```

The log never carries credentials, username, or SQL text. Pipe this into your SIEM and alert on:

- `host` matching the parsed host of `DATABASE_URL` — catches operators who pasted the app DB connection string with the app's own role.
- High-cardinality dial bursts — catches a runaway loop or a credential-stuffing test.

This is the SRE-facing replacement for the deleted code guard. It does not prevent a misconfiguration, but it surfaces one within seconds of first use.

---

## 6. Verification checklist (before exposing a new attached DB to chat)

- [ ] Network: attached DB lives on a different segment from the app DB, OR the agent has been explicitly pointed at the app DB via a `chat_app_reader` role per § 5.
- [ ] Role: connection uses a `chat_reader` (or `chat_app_reader`) least-privilege role with `SELECT`-only grants.
- [ ] Role: `REVOKE EXECUTE` on `pg_read_file`, `pg_read_binary_file`, `lo_import`, `lo_export`, `dblink`, `dblink_exec` (the validator's deny-list functions).
- [ ] Role: `REVOKE SELECT` on `pg_catalog.pg_shadow` and `pg_catalog.pg_authid` (defense-in-depth against any future validator regression on instance-metadata catalogs).
- [ ] Allowlist: `allowed_tables` set to the smallest useful subset, OR confirmed acceptable that the role grants are themselves narrow.
- [ ] RLS (if applicable): policies in place for any multi-tenant table the role can `SELECT`.
- [ ] Connection tested via `/test`: returns `{ ok: true }` before saving.

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

- [`docs/decisions/ADR-010-supersede-app-db-host-guard.md`](./decisions/ADR-010-supersede-app-db-host-guard.md) — current decision (host+port guard removed; read-only contract replaces it).
- [`docs/adr/0001-app-agent-data-plane-soc.md`](./adr/0001-app-agent-data-plane-soc.md) — superseded; kept for history.
- [`docs/sql-connections-key-rotation.md`](./sql-connections-key-rotation.md) — master-key rotation playbook.
- [`src/shared/security/host-validator.ts`](../src/shared/security/host-validator.ts) — SSRF guard implementation (unchanged).
- [`src/modules/projects/application/providers/database/sql-validator.ts`](../src/modules/projects/application/providers/database/sql-validator.ts) — SQL deny-list / read-only enforcement (Slice 1 extended with instance-metadata vectors).
- [`src/modules/projects/application/providers/database/read-only-sql-database.ts`](../src/modules/projects/application/providers/database/read-only-sql-database.ts) — `SET TRANSACTION READ ONLY` chokepoint.
- [`src/modules/projects/application/providers/database/sql-datasource.factory.ts`](../src/modules/projects/application/providers/database/sql-datasource.factory.ts) — agent-time DataSource factory (SSRF guard only after ADR-010).
