---
id: SPEC-005
title: "SPEC-005: Chat contract (conversations, SSE agent, read-only data plane)"
status: Implemented
layer: contract
owner: Mariano Ravinale
created: 2026-06-04
updated: 2026-06-04
feature_paths:
  - src/modules/chat
related_adrs: [ADR-002]
related_specs: [SPEC-002, SPEC-003, SPEC-004, SPEC-006]
counterpart_spec: "spa-velocity#SPEC-005"
coordination_doc: ""
---

# SPEC-005: Chat contract

> **Backfill** — current, test-backed contract. ACs map to existing Jest specs. The `ui` counterpart
> is `spa-velocity#SPEC-005`. The agent's read-only data-plane separation follows `docs/adr/0001-app-agent-data-plane-soc.md`.

## 1. Summary (intended behavior)

RBAC-gated, org-scoped conversations + messages with an **SSE streaming** agent. The agent (OpenAI;
keyless fallback when unconfigured) does RAG over project Airweave collections and routes SQL questions
to a **read-only** sub-agent that connects per-request to the project's SQL connections — enforcing
`SET TRANSACTION READ ONLY`, an SSRF host guard, and a per-connection `allowedTables` allowlist
(plumbed from `org_sql_connection`). Streamed + persisted assistant content is sanitized (SQL/JSON
fences stripped; markdown tables normalized). Permissions: `chat:{read,create,stream,delete}`.

## 2. Context & problem

Chat is the agentic core and the biggest security surface (it runs generated SQL against tenant
databases). Load-bearing rules: the read-only data plane (ADR-0001 — separate role/pool/credentials/
lifetime), the SSRF guard, the `allowedTables` allowlist, and the ADR-002 scope contract for listing.

## 3. Scope

**In scope:** conversation/message endpoints (list/create/get/send/stream/delete) + RBAC + org scope;
SSE event contract; auto-title; ready-source filtering; agent fallback chain + graceful degradation;
RAG dedup/multi-source resilience; content sanitization; read-only transaction mode; SSRF guard;
`allowedTables` plumbing; migration ordering (projects before chat).

**Out of scope / non-goals (thin/unverified — §9):** **`allowedTables` ENFORCEMENT at query time
(only the config plumbing is tested — the mock `SqlDatabase` doesn't filter)**; live LangChain tool
execution (mocked); throttle actually blocking; multi-connection-in-one-call routing.

## 4. Assumptions

1. [Confirmed] Endpoints carry `chat:{read,create,stream,delete}`; non-superadmin requires an active org; `scope=all` is superadmin-only (`chat.controller.spec.ts:53,93,116,331`).
2. [Confirmed] SSE emits start/thinking/searching/chunk/complete and an error event on failure (`chat.controller.spec.ts:196,268`).
3. [Confirmed] Agent uses the keyless fallback when OpenAI is unconfigured and degrades gracefully when the agent path throws (`chat-agent.service.spec.ts:158,250`).
4. [Confirmed] The SQL sub-agent runs read-only (`SET TRANSACTION READ ONLY`), rejects writes, and is SSRF-guarded (`read-only-sql-database.spec.ts:65,74`; `sql-datasource.factory.spec.ts:32`).
5. [Confirmed] `allowedTables` is forwarded as `includesTables` to the SQL database layer (`read-only-sql-database.spec.ts:120`).
6. [Unconfirmed] `allowedTables` actually RESTRICTS table access at query time — the mock doesn't enforce it; **no live test** (§9, highest-value gap).

## 5. Affected areas

- `src/modules/chat/{api,application,infrastructure}/*` — controller, `ChatService`, `ChatAgentService`, agent tools, router, raw-SQL repository.
- Read-only data plane: `ReadOnlySqlDatabase`, `SqlDataSourceFactory`, `ChatToSqlService` (cross-module with SPEC-003 `allowedTables`).
- Entities/migrations: `conversation`, `message` (metadata JSONB: generator/sources/sqlCalls/tokens); `chat.migration.ts` (runs after projects migrations; backfills `project_id`).
- Endpoints: `GET/POST /api/chat/conversations`, `GET .../{id}/messages`, `POST .../{id}/messages[/stream]`, `DELETE .../{id}`.

## 6. Acceptance criteria (mapped to existing tests)

| # | Criterion | Proving test |
|---|---|---|
| AC1 | Endpoints apply PermissionsGuard+Throttler; list scope; `scope=all` superadmin-only; no-active-org → 403; blank content rejected | `chat.controller.spec.ts:53,93,116,321,331` |
| AC2 | SSE streams start/thinking/searching/chunk/complete; error event on generator throw | `chat.controller.spec.ts:196,268` |
| AC3 | Create + auto-title untitled; reject create without projectId; no re-title when titled | `chat.service.spec.ts:251,275,287,513` |
| AC4 | Non-ready project sources filtered before invoking the agent | `chat.service.spec.ts:366` |
| AC5 | Agent fallback: keyless when no key; no-results / no-sources fallbacks; agent path with key; degrade to keyless on agent error | `chat-agent.service.spec.ts:158,175,191,205,250` |
| AC6 | RAG tool: forwards via registry; dedupes by entityId (highest relevance); multi-source failure-resilient; empty-results note | `chat-agent-tools.spec.ts:120,203,275,307` |
| AC7 | Content sanitization: SQL fences stripped in live chunks AND persisted; non-SQL code preserved; markdown tables normalized | `chat-agent-streaming-fence.integration.spec.ts:170,271`; `chat-agent.service.spec.ts:811` |
| AC8 | Read-only data plane: write rejected pre-transaction; `SET TRANSACTION READ ONLY`; SSRF host guard | `read-only-sql-database.spec.ts:65,74`; `sql-datasource.factory.spec.ts:32` |
| AC9 | `allowedTables` forwarded as `includesTables` (provided → array; omitted/undefined → none) | `read-only-sql-database.spec.ts:120,129,136` |
| AC10 | Repository: create message touches parent timestamp in a transaction; list messages has a default limit | `chat.database-repository.spec.ts:84,70` |
| AC11 | Migrations: projects run before chat; backfill `project_id` from the org "General" project | `chat.migration.spec.ts:49,115` |

## 7. Implementation plan

N/A — backfill. **Next change here should close the AC-gap:** an integration test proving `allowedTables` actually restricts table introspection/queries against a real Postgres.

## 8. Testing plan

Jest unit + integration: `src/modules/chat/**/*.spec.ts` (controller, service, agent, tools, router, repository, migration; streaming-fence + behavior-pin integration). Data plane: `read-only-sql-database.spec.ts`, `sql-datasource.factory.spec.ts`. Run `npx jest src/modules/chat`.

## 9. Risks & failure modes

- **`allowedTables` enforcement is unverified end-to-end (HIGH):** config is plumbed + tested, but the mock `SqlDatabase` doesn't filter, so a LangChain regression that ignores `includesTables` would NOT be caught. This is the chat-to-SQL security boundary — close with a real-Postgres test.
- Read-only role/SSRF are tested; live LangChain tool execution is mocked.
- Throttle is configured but not exercised; multi-connection routing not covered.

## 10. Open questions

- Should the `allowedTables` enforcement test live here (SPEC-005) or in `api-velocity#SPEC-003`? (Cross-module boundary.)

## Change Log

- 2026-06-04 · PR (backfill) · created · documents the Chat contract; 11 ACs mapped to existing Jest specs; the allowedTables-enforcement gap flagged as the top follow-up.
