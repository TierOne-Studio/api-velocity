# ADR-010: Supersede the host+port app-DB guard; rely on the read-only contract

**Status:** Accepted (2026-05)
**Date:** 2026-05-19
**Deciders:** Engineering (api-velocity)
**Supersedes:** [ADR-0001](../adr/0001-app-agent-data-plane-soc.md) — partially (axes 4–5 of the seven-axis separation now do the work that the code-level Layer C used to provide; axes 1–3, 6–7 are unchanged)

## Context

[ADR-0001](../adr/0001-app-agent-data-plane-soc.md) defined a seven-axis separation between the chat-to-SQL agent path and the application's own DB. Three of the seven axes (DataSource instance, connection pool, lifetime — "structural" separation) and two more (credentials, config source-of-truth) were code-enforced in `SqlDataSourceFactory`. One of the code enforcements was a **host+port blocklist** (Layer C in the three-layer security stack described in `CLAUDE.md`): the factory refused to dial any `host:port` matching an entry in `AGENT_FORBIDDEN_DATABASES`, which defaulted to `[DATABASE_URL]`.

This guard had a real cost. The most common production deployment is an AWS Elastic Beanstalk app talking to an RDS Postgres in the same VPC. If an operator wants the chat agent to answer questions against the application's own database — a common and reasonable ask, especially for "how many users do I have?" style questions where the data the user is asking about IS in the app DB — the guard refuses the connection with `"Refusing to connect to the application database via a user SQL connection"`.

The guard's original threat model was clear from the `S1` doc-comment in `sql-datasource.factory.ts`: even if an operator pointed the agent at a sibling DB on the same Postgres instance (e.g. `myapp_analytics` on the same RDS as `myapp`), `dblink` / `postgres_fdw` chains would let a query inside `myapp_analytics` reach across to `myapp` and write. So the guard widened from `host+port+database` to `host+port` — block the whole instance.

By 2026-05, three things had shifted:

1. **The SQL validator already blocks `DBLINK` / `DBLINK_EXEC` / `POSTGRES_FDW_*`** as part of the keyword deny-list. The specific attack vector the host+port guard was added to defend against is now neutralized at validation time.

2. **The validator was extended (this PR's Slice 1, see commit `ca18436`)** to block app-instance metadata vectors: `pg_shadow`, `pg_authid`, `pg_roles`, `pg_stat_activity`, `pg_settings`, `pg_hba_file_rules`, `pg_file_settings`, replication-slot catalogs, function-form bypasses (`pg_stat_get_activity`, `pg_show_all_settings`, ...), and `SHOW` of filesystem / TLS-material / Kerberos / replication-conninfo parameters (including `SHOW ALL`). These are the leak surfaces that Layer C blocked structurally by refusing the dial; now Layer A blocks them at the validator.

3. **`SET TRANSACTION READ ONLY`** has been the chokepoint enforcement on every query via `ReadOnlySqlDatabase.run()` since `feature/natural-sql`. There is no in-process bypass (no fallback to `appDataSource.query()` — see `read-only-sql-database.ts:14-15`).

The remaining concern after Layer C removal is **defense-in-depth**: Layer C used to catch a regression in any of Layers A or B. With Layer C gone, the operator-provisioned **Postgres role grants** become the sole guarantee that an attack which bypassed Layers A and B simultaneously cannot also write. The operator-runbook (`docs/sql-connections-operations.md`) is now load-bearing for that guarantee.

## Decision

We will **remove the code-level host+port app-DB guard** (`checkForbiddenAppDatabase`, `assertNotAppDatabase`, `forbiddenUrls` ctor arg, `getAgentForbiddenDatabases()`, `AGENT_FORBIDDEN_DATABASES` env var). The chat-to-SQL agent path is permitted to dial any host the SSRF guard allows (RFC1918 / loopback / link-local / cloud-metadata remain blocked).

The read-only contract is the **only** code-level guarantee that a chat query cannot mutate the database it dials. That contract has three independent code layers:

- **Layer A — SQL validator deny-list** (`sql-validator.ts`). Blocks every DML/DDL keyword, function-call vectors that reach the filesystem / network / auth material (`pg_read_file`, `lo_import`, `dblink`, ...), and (per Slice 1 of this change) instance-metadata catalogs and `SHOW`-sensitive parameters.
- **Layer B — `SET TRANSACTION READ ONLY`** (`read-only-sql-database.ts`). Postgres-level enforcement on every query; cannot be bypassed in-process.
- **Layer D — operator-provisioned Postgres role grants** (`docs/sql-connections-operations.md` § 2 + § 5). `SELECT`-only on named schemas, no grants on auth tables, `REVOKE EXECUTE` on filesystem / network functions, `REVOKE SELECT` on `pg_catalog.pg_shadow` / `pg_catalog.pg_authid`.

Layer C (this guard) is removed. The seven-axis separation from ADR-0001 still holds, but axis 4 (network segmentation) and axis 5 (Postgres role) now do all the work that this code layer used to share with them.

## Alternatives considered

- **Alt A — Keep the guard, make it opt-out via env.** Default would still block the app DB; operators who explicitly want app-DB access would set `SQL_AGENT_ALLOW_APP_DB=true`. Rejected: leaves dead code permanently for the "want app DB" case, and the operator-mistake risk it protects against (an operator pasting `DATABASE_URL` into a project config) is better caught by deploy-time tooling than by application logic. Also, the SSRF guard is the load-bearing dial-time check now; one knob is simpler than two.

- **Alt B — Keep the guard, narrow the match to `host+port+database`.** Rejected: that's exactly the configuration the `S1` widening was meant to escape. `dblink` reaches across sibling DBs on the same instance, so blocking `myapp` but allowing `myapp_analytics` provides only a thin barrier. Either we block the instance or we don't.

- **Alt C — Move the guard to a per-`sql_connection` flag (`allow_app_db: boolean`).** Rejected: pushes a security decision into the per-row data plane, where it can be silently flipped via a DB write that bypasses code review. Code-or-network is the right granularity for this kind of guard, not data.

- **Alt D — Replace with a CIDR-style allowlist (`AGENT_ALLOWED_DATABASES`).** Rejected: introduces a new env-var contract for a security decision the network layer (VPC / security group / egress allowlist) already enforces better. We don't want application code to be the source of truth for which Postgres endpoints are reachable.

## Consequences

### Positive

- Operators can now use the chat agent against the application's own database with a `chat_app_reader`-style read-only role. This is the most common ask for organizations whose primary data lives in the app DB.
- The threat-model surface is more honest: the agent's read-only guarantee depends on the validator + `SET TRANSACTION READ ONLY` + role grants, not on a brittle hostname comparison. Layer C was always a defense-in-depth layer; removing it forces the other layers to carry their stated weight.
- One fewer env-var contract to keep coherent across environments (the bootstrap previously had to ensure `AGENT_FORBIDDEN_DATABASES` listed every internal endpoint).
- Smaller code surface in `SqlDataSourceFactory` and `ConfigService`; fewer tests to maintain.

### Negative

- **No code-level safety net against an operator pasting `DATABASE_URL` into a project's SQL connection with the app's regular DB role.** The validator + `SET TRANSACTION READ ONLY` would still prevent writes, but reads of the following tables would succeed:
  - `auth_token` — active bearer tokens for every signed-in user.
  - `session` — live session rows.
  - `sql_connection.password_ciphertext` — AES-GCM-encrypted credentials for **every other attached DB across every org**. The key lives in env (not the DB), so an attacker would need separate access to escalate to plaintext — but credential-at-rest encryption is the only barrier, not unreachability.
  - `user` — all PII (email, name, role assignments).
  - `organization`, `role`, `permission`, `role_permission` — the entire RBAC graph.

  Mitigations layered onto this:
  - The runbook (`docs/sql-connections-operations.md` § 5) prescribes a separate `chat_app_reader` role with explicit `REVOKE SELECT` on every table listed above + the instance-metadata catalog set + the validator's function deny-list.
  - A new structured audit log fires on every dial (`[agent.dial]` in the factory). Pipe to SIEM and alert on `host` matching the parsed `DATABASE_URL` host to catch misconfigurations within seconds of first use. This is the SRE-facing replacement for the deleted code guard.

  **This shifts a code-enforced invariant into an operational practice plus an audit-log tripwire.** Deploy-time tooling (IAM policy, secrets-manager rule, CI lint on the deployment config) remains the right place to encode "thou shalt not use the app role for chat" — the audit log catches what slips through.

- **Validator-deny-list regressions are no longer caught structurally.** If a future PR drops `DBLINK` from the deny-list, today (with Layer C present) the host+port guard would still refuse the dial. After this ADR, the same query against the app DB would reach Postgres. Mitigation: the validator spec now has explicit regression-tripwire tests for `DBLINK`/`DBLINK_EXEC` and all the instance-metadata vectors, and an exported `SHOW_SENSITIVE_PARAMS` constant the spec loops over (so adding/removing entries auto-generates tests).

- **The `docs/adr/` vs `docs/decisions/` split persists.** This ADR lives under `docs/decisions/` (the active convention with ADR-001..ADR-009). ADR-0001 lives under `docs/adr/` (legacy location). Resolution deferred — flagged as a separate `lessons-curator` task.

### Follow-ups

- **`app-agent-separation.spec.ts`** that asserts the agent's read-only contract structurally — e.g., spins up a Postgres testcontainer, points the agent at the same instance as the app DB role would, and asserts every DENY_WORDS entry + every `SHOW_SENSITIVE_PARAMS` entry round-trips to a `ReadOnlyViolation`. Currently the validator is tested via unit tests against the static input; a smoke test against a real Postgres would close the gap that "the validator denies the string" and "Postgres would reject the query anyway" are different invariants.

- **SSRF-allowlist for the app DB's private IP.** Today, pointing the agent at an RDS in a private VPC requires either a public endpoint or an internal NLB with a routable IP. A future ADR could add a per-deployment `AGENT_ALLOWED_PRIVATE_HOSTS` allowlist to the SSRF guard, narrowly opening the door for "agent dials this one private IP that I've explicitly approved".

- **Revisit `SQL_AGENT_ALLOW_WRITES`** (`src/shared/config/config.service.ts:378`). The flag exists to allow agent writes when explicitly opted in. Combining it with this ADR's removal of Layer C would make the agent write-capable against the app DB — catastrophic. Worth either removing the flag entirely (writes never supported), gating it behind a second "I-know-what-I-am-doing" confirmation env, or fail-closing it in `NODE_ENV=production`. Not done in this PR (orthogonal surgical-diff discipline); tracked here so it isn't lost.

- **`docs/adr/` → `docs/decisions/` consolidation.** Either move ADR-0001 to `docs/decisions/` and renumber to `ADR-011` (since `010` is taken), or move ADR-001..ADR-009 to `docs/adr/`. Whichever — pick one location and converge. Tracked as a `lessons-curator` action item.

- **`Partially superseded` ADR-status idiom.** The `documentation-and-adrs` skill template only lists `Proposed | Accepted | Deprecated | Superseded by ADR-XXX`. This ADR introduces "Partially superseded" because ADR-0001's axes 1–3, 6–7 still hold. Lessons-curator candidate: codify the new status (or pick a different idiom) in the skill so this isn't precedent set by accident.

## References

- **Removed code surfaces:**
  - `src/modules/projects/application/providers/database/sql-datasource.factory.ts` — `checkForbiddenAppDatabase`, `ForbiddenAppDbCheck`, `assertNotAppDatabase`, `forbiddenUrls` ctor arg.
  - `src/shared/config/config.service.ts` — `getAgentForbiddenDatabases()`.
  - `src/modules/projects/application/providers/database/chat-to-sql.service.ts` — second arg to `SqlDataSourceFactory` ctor in `createFactory()`.
  - `.env.example` — `AGENT_FORBIDDEN_DATABASES` line.
- **Replacement code surfaces (unchanged in this ADR — extended in the Slice 1 commit):**
  - `src/modules/projects/application/providers/database/sql-validator.ts` — Layer A deny-list incl. instance-metadata catalogs and `SHOW_SENSITIVE_PARAMS`.
  - `src/modules/projects/application/providers/database/read-only-sql-database.ts` — Layer B `SET TRANSACTION READ ONLY` chokepoint.
  - `src/shared/security/host-validator.ts` — SSRF guard (`assertSafeAgentHost`). Unchanged; still the only dial-time host check.
- **Operator runbook:** `docs/sql-connections-operations.md` § 2 + § 5 (rewritten for this change).
- **Related skills:**
  - `repo-conventions` — high-risk surface restate requirement (P3.3) applied to this change.
  - `documentation-and-adrs` — supersession protocol followed (mark ADR-0001 with `Superseded by:` link, write this ADR with `Supersedes:` link).
- **Pull requests:**
  - Slice 1 — PR #18, `fix(sql-validator): deny app-instance metadata-leak vectors`. Extends Layer A with the catalogs and `SHOW` params that previously relied on Layer C blocking the dial. (Branch: `fix/sql-validator-deny-instance-metadata`. Commit hash assigned at squash-merge time.)
  - Slice 2 — this ADR. (Branch: `fix/remove-app-db-host-guard`, stacked on Slice 1's branch. PR # assigned on creation.)
