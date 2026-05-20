# ADR-0001 — Chat-to-SQL agent runs on a separate data plane from the application database

**Status:** Partially superseded (2026-05) by [ADR-010](../decisions/ADR-010-supersede-app-db-host-guard.md)
**Supersedes:** —
**Superseded by:** [ADR-010](../decisions/ADR-010-supersede-app-db-host-guard.md) (host+port code-level guard removed; axes 1–3, 6–7 of the seven-axis separation now hold via the read-only contract instead — see ADR-010 § Decision)

> **What changed:** axes 1–3 (DataSource instance / pool / credentials) and 6–7 (lifetime / config source-of-truth) are still enforced as written below. **Axis 4–5 (network + Postgres role)** now do all the work that the host+port guard used to provide. The `checkForbiddenAppDatabase` / `assertNotAppDatabase` code below is removed; `AGENT_FORBIDDEN_DATABASES` is no longer read. See ADR-010 for the threat-model trade-offs.

## Context

The chat feature added in `feature/natural-sql` lets an org member ask a natural-language question that the inner sub-agent translates into a read-only SQL query against an org-owned Postgres database. The org member's authorization to ask the question is enforced by the application's own database (auth, sessions, RBAC, sql-connection ownership). The database the LLM ultimately queries is a separate, user-attached system.

These two data planes have very different trust profiles:

| | Application DB | Attached agent DB |
|---|---|---|
| Trust source | Built and owned by us | Org member supplies host + credentials |
| Contents | Auth tokens, user PII, sessions, sql-connection secrets, RBAC | Whatever the org has there — could be product analytics, customer data, audit logs |
| Access pattern | Process-lifetime TypeORM pool | Per-request DataSource that lives one chat turn |
| Role | App role with full read/write on app schema | Should be a least-privilege read-only role |

The risk if these planes blur — even slightly — is high:

- An LLM-driven `SELECT` against an unbounded DB is a manageable attack surface if the DB only holds what the org has explicitly put there.
- That same surface against a DB that also holds *the system's auth state* is a confused-deputy escalation: the LLM (which we don't fully trust) reaches data the user (whom we do trust) couldn't otherwise reach.
- Resource starvation of the app pool by a runaway agent query would degrade the whole product.

## Decision

The chat-to-SQL agent path and the application's own database access **MUST NOT** share any of the following:

1. **`DataSource` instance** — the agent path creates a fresh `new DataSource(...)` per chat turn; the app uses a long-lived TypeORM `DataSource` registered at boot.
2. **Connection pool** — agent pool is request-scoped (`max: poolMax`), destroyed in `finally` via `factory.destroyAll()`; app pool is process-lifetime.
3. **Credentials** — agent uses user-supplied credentials decrypted from `sql_connections` per request; app uses `DATABASE_URL`.
4. **Network segment** — operational, not code-enforceable; documented in the runbook (`sql-connections-operations.md`).
5. **Postgres role** — the attached connection MUST point at a least-privilege role (`chat_reader` per the runbook); the app DB user has full app-schema rights.
6. **Lifetime** — agent DataSources die at end-of-request; app DataSource lives for the process.
7. **Configuration source-of-truth** — agent connections come from `org_sql_connection` rows; app DB comes from `DATABASE_URL`. Never reuse a config key across planes.

**Code-level enforcement** of axes 1–3 and 6–7 lives in `SqlDataSourceFactory` (see `src/modules/projects/application/providers/database/sql-datasource.factory.ts`). The factory:

- Is constructed per chat turn from `ChatToSqlService.createFactory()`.
- ~~Refuses to dial any host that matches an entry in `AGENT_FORBIDDEN_DATABASES` (defaults to `[DATABASE_URL]`) at `host + port` granularity, regardless of database name. Sibling DBs on the same physical instance are blocked.~~ **[Superseded by ADR-010 — guard removed. Replacement: SQL validator instance-metadata deny-list + `SET TRANSACTION READ ONLY` chokepoint + operator-provisioned `chat_app_reader` role + dial-time audit log.]**
- ~~Fails closed on a malformed forbidden URL (a security check that silently degrades on bad input is not a security check).~~ **[Superseded by ADR-010 — no URL list anymore.]**
- Refuses any host that resolves to a private / loopback / link-local / cloud-metadata IP (SSRF defense in depth; the connection tester goes through the same guard). **[Unchanged.]**

Axes 4–5 (network segmentation, Postgres role) **cannot** be enforced from code. They're operational invariants documented in `docs/sql-connections-operations.md` and called out in the README / setup checklist. **[After ADR-010, axes 4–5 do all the work that axis-3-enforcement-of-app-DB-segregation used to share with them — see ADR-010 § Decision.]**

## Consequences

### Positive

- ~~A confused-deputy escalation through the LLM cannot reach app auth/session state, because the agent path is structurally incapable of dialing the app DB.~~ **[Superseded by ADR-010 — the agent path CAN now dial the app DB. The confused-deputy bound is now: validator + RO transaction + role grants. See ADR-010 § Consequences/Negative for the specific tables at risk if an operator misuses this and the audit-log tripwire that catches it.]**
- Resource starvation of the app pool by agent traffic is bounded by the agent's own per-request pool (`SQL_AGENT_POOL_MAX`, validated at boot).
- Future security additions (per-org keys, KMS-managed credentials, RLS on attached DBs) can layer cleanly on top of the structural split.

### Negative

- Two TypeORM stacks in the same process — small operational surface for misconfiguration. Mitigated by the boot-time validation of `PROJECT_SOURCE_SECRET_KEY` and `AGENT_FORBIDDEN_DATABASES`.
- The per-request `DataSource` model trades startup latency for isolation. Acceptable for chat traffic; would not be for high-QPS API surfaces.

### Open invariants

- **DNS rebinding**: the SSRF guard validates the host string and the resolved IPs at dial time, but a DNS server that returns a public IP first and a private IP a millisecond later still wins. The stronger fix (resolve once, dial by IP) is tracked as a follow-up; the current guard meaningfully raises the bar.
- **Cross-org leakage**: org isolation today is enforced at attach time (`findManyByIdsForOrg` filters by `orgId` from the request context). If a future refactor moves resolution outside the request scope, isolation could silently weaken. A test that asserts the boundary explicitly (`app-agent-separation.spec.ts`) is a recommended follow-up.

## Implementation references

| Concern | Enforcement | Spec |
|---|---|---|
| SSRF host denylist | `assertSafeAgentHost` (shared) | `src/shared/security/host-validator.spec.ts` |
| ~~App DB host blocklist~~ | ~~`checkForbiddenAppDatabase`~~ — **removed in ADR-010** | — |
| ~~Multi-URL forbidden list~~ | ~~`AGENT_FORBIDDEN_DATABASES` env~~ — **removed in ADR-010** | — |
| Validator deny-list (SQL functions that cross the trust boundary) | `sql-validator.ts` | `sql-validator.spec.ts` |
| Per-connection table allowlist | `org_sql_connection.allowed_tables` → `includesTables` | `read-only-sql-database.spec.ts` |
| Inner-error scrubbing | `sanitizeAgentError` | `sql-error-sanitizer.spec.ts` |
| AES-GCM credential at rest, key rotation | versioned ciphertext + dual-key decrypt + lazy upgrade | `aes-gcm.spec.ts`, `sql-connections.service.spec.ts` |
| Real-Postgres smoke verification | testcontainers + Postgres | `postgres-roundtrip.smoke.spec.ts` (opt-in via `npm run test:smoke`) |

## Future ADRs

- **Per-org master keys** for sql-connection password encryption. Today a single `PROJECT_SOURCE_SECRET_KEY` covers every org.
- **KMS-managed key escrow** in place of env-var keys.
- **Strict-resolve-then-dial-by-IP** SSRF model (current model is resolve-and-validate-then-dial-by-name; DNS rebinding remains a theoretical residual risk).
- **`app-agent-separation.spec.ts`** asserting the seven axes structurally (e.g. by tracking the agent factory's connections separately and verifying they never appear in the app pool's manifest).
