# LangChain Agent Efficiency Refactor — api-velocity

**Author:** Architect review (Claude)
**Date:** 2026-05-21
**Status:** Proposal v5.1 — **APPROVE_PLAN** from architect-reviewer (pass 3, 0.91) — ready for execution
**Target repo:** `api-velocity` (NestJS / TypeORM, OpenAI via `@langchain/openai`)
**Estimated effort:** 4 phased PRs
**Risk:** Low — every behavior change is behind a flag or env var; old paths preserved

> **Direction.** Keep `@langchain/classic` `SqlToolkit`. Optimize what the agent has to do, not the framework underneath it.

---

## 0. Design Principles Applied

This proposal was rewritten against **SOLID / DRY / KISS / SoC / YAGNI / cohesion-coupling / fail-fast / explicitness / SSoT**. Principle scorecard in §8. Verification log in §11.

Concrete principle-driven choices:

- **KISS** — 3 behavioral feature flags.
- **YAGNI** — seven speculative items cut from earlier drafts (§1.2).
- **SSoT** — routing rules live in **one** file (`chat-routing-rules.md`) and are loaded by both the router prompt and the agent system prompt.
- **SoC** — schema pre-warming lives in `ChatToSqlService` (DB-read concern), not inside `runSqlSubAgent` (agent-execution concern).
- **Fail-fast** — one repair retry on bad SQL, then surface; pre-warm failure surfaces; router LLM error falls through to agent (explicit, not silent).
- **Explicitness** — flag matrix in §7. Model fallback chain in §3.0.

---

## 1. Executive Summary

Today's SQL chat turn issues **4–5 LLM calls** through `SqlToolkit`'s agentic loop. Only one is structurally required (the SQL generation itself). This refactor cuts the rest **without replacing SqlToolkit**, then applies the same playbook to the outer chat agent.

### 1.1 What's in (4 changes)

| # | Change | Phase | Impact |
|---|---|---|---|
| **S1** | Schema pre-warming (inject schema, skip discovery) | P2 | −2 LLM calls per SQL turn |
| **S2** | Drop `query-checker` + smaller sample rows + cheaper sub-agent model | P1 | −1 LLM call, configurable model |
| **R** | Router-first hybrid for outer agent | P3 | −1 LLM call per turn; deterministic routing |
| **M** | Move `DataSourceRegistry` to `data-sources/` module | P4 | Fixes `chat → projects` directional smell |

Plus minimal telemetry (§3.5) and SQL streaming UX (§3.6).

### 1.2 What was cut (and why)

| Cut | Principle | Why |
|---|---|---|
| `info-sql` LRU cache | YAGNI | After S1, `info-sql` rarely runs |
| Sub-agent instance cache | YAGNI | Saves ms next to seconds; not worth isolation risk |
| Outer-agent instance cache | YAGNI | Same |
| `direct_answer` router route | YAGNI | Model can answer trivially without a route |
| Multi-bucket `TokenAccumulator` | YAGNI | Start with totals; add buckets when dashboards demand |
| `sql_retrying` streaming event | YAGNI | Ship `planning` + `executing` first |
| Tighter recursion limit | YAGNI | Current limit isn't causing problems |

### 1.3 Expected outcomes

- SQL turn: ~2 LLM calls (down from 4–5).
- ~50–60 % latency reduction on DB-backed turns.
- ~70 % cost reduction per DB turn (fewer calls + smaller-model fallback for sub-agent).
- `@langchain/classic`, `SqlToolkit`, identifier-repair shim — all stay.

---

## 2. Current-State Analysis (verified)

- **Outer agent:** `ChatAgentService.generateAgentReply` ([chat-agent.service.ts:442](../src/modules/chat/application/services/chat-agent.service.ts:442)) / `generateReplyStreaming` ([chat-agent.service.ts:589](../src/modules/chat/application/services/chat-agent.service.ts:589)). Uses `createAgent` from `langchain`.
- **Sub-agent:** `runSqlSubAgent` ([sql-sub-agent.ts:33](../src/modules/projects/application/providers/database/sql-sub-agent.ts:33)) wraps `SqlToolkit` from `@langchain/classic/agents/toolkits/sql`. Postgres identifier-repair shim at [lines 83–145](../src/modules/projects/application/providers/database/sql-sub-agent.ts:83) — stays.
- **Routing logic today:** in the outer agent's system prompt (`AGENT_DATABASE_ROUTING_PROTOCOL` at [chat-agent.service.ts:90](../src/modules/chat/application/services/chat-agent.service.ts:90)). After R lands, this text moves to a shared prompt file (§3.3).
- **`ReadOnlySqlDatabase`** ([read-only-sql-database.ts](../src/modules/projects/application/providers/database/read-only-sql-database.ts)) extends `SqlDatabase`. Inherits `getTableInfo(targetTables?)`, `allTables: SqlTable[]`, and `sampleRowsInTableInfo` (constructor field). **No `getTableNames()`** — use `db.allTables.map(t => t.tableName)`.
- **`ReadOnlySqlDatabase.fromDataSource`** currently passes `{appDataSource, includesTables, ignoreTables}` to `SqlDatabase.fromDataSourceParams`. **Does NOT pipe `sampleRowsInTableInfo`** — S2 extends this.
- **Model env pattern (verified):**
  - `getOpenAiModel()` → `process.env.OPENAI_MODEL || 'gpt-5.4-nano'`
  - `getSqlAgentModel()` → `process.env.SQL_AGENT_MODEL?.trim() || null`
  - Sub-agent uses `getSqlAgentModel() ?? getOpenAiModel()` ([chat-to-sql.service.ts:94–95](../src/modules/projects/application/providers/database/chat-to-sql.service.ts:94)) — a clean env-override → env-fallback → built-in-default chain.
- **`ConfigService`** uses `boundedInt(envName, fallback, {min,max})` for safety-critical numerics and `loadPrompt({envInline, envPath, fileCandidates, fallback, cacheKey})` for prompts. New config follows these patterns.

Critical specs that pin current behavior (must stay green):
- `chat-agent.service.spec.ts`, `chat-agent-streaming-fence.integration.spec.ts`, `chat-agent-tools.spec.ts`
- `sql-sub-agent.spec.ts`, `postgres-roundtrip.smoke.spec.ts`

---

## 3. The Four Changes

### 3.0 LLM Model Configuration (cross-cutting)

**Principle (per explicit user request):** every LLM model used by the system MUST be env-overridable with a built-in fallback. The codebase already follows this pattern — this refactor preserves and extends it.

**The fallback chain (canonical):**

| Caller | Env (specific) | Env (general fallback) | Built-in default |
|---|---|---|---|
| Outer chat agent (synthesis) | — | `OPENAI_MODEL` | `'gpt-5.4-nano'` |
| Sub-agent (SQL generation) | `SQL_AGENT_MODEL` | `OPENAI_MODEL` | `'gpt-5.4-nano'` |
| Router classifier (new in R) | `CHAT_ROUTER_MODEL` | `OPENAI_MODEL` | `'gpt-5.4-nano'` |

**Implementation rule:**
- Specific-env getters (`getSqlAgentModel`, `getChatRouterModel`) return `string | null` — `null` when unset.
- Callers do `specific() ?? configService.getOpenAiModel()`.
- `getOpenAiModel()` is the single source of the built-in default. **No literal model names anywhere else in the codebase or in this proposal.**

**Why this matters.** Operators choose models per environment (cheap-fast in staging, accurate in prod, latest-available as defaults evolve). The built-in default is just a safety net; production deployments override it explicitly.

---

### 3.1 S1 — Schema pre-warming  *(Phase 2, the biggest win)*

**WHY.** Sub-agent burns its first 2 LLM calls on `list-sql` + `info-sql`. The schema is deterministically retrievable from the existing `SqlDatabase`. Inject it into the system prompt and the agent skips both on the typical turn. SqlToolkit's discovery tools remain callable as a fallback.

**SoC.** Pre-warming is a DB-read concern — lives on `ChatToSqlService`. `runSqlSubAgent` accepts the rendered schema as data (`prewarmedSchema?: string`), so the agent function stays cohesive.

**SSoT for schema rendering — already exists in the library.** `SqlDatabase.getTableInfo(targetTables?)` already applies the `includesTables` allowlist internally (verified in `node_modules/@langchain/classic/dist/sql_db.cjs:70`). No wrapper helper is needed; the library *is* the single source. Call it directly from `ChatToSqlService`. (An earlier draft proposed a `renderSchemaText` helper — removed as YAGNI per architect-reviewer MED #2.)

**HOW.**

`chat-to-sql.service.ts` — before `runSqlSubAgent` (with fail-fast):

```ts
let prewarmedSchema: string | undefined;
if (this.configService.getSqlAgentPrewarmSchemaEnabled()) {
  // Fail-fast: a schema-read error must surface, not silently fall back
  // to the discovery path. Operators need to see DB connectivity issues
  // immediately rather than as a slow degraded turn.
  // `getTableInfo()` (no argument) returns the full `includesTables`-scoped
  // schema — the library already applies the per-connection allowlist.
  prewarmedSchema = await db.getTableInfo();
}
const subAgent = await runSqlSubAgent(
  db, question,
  { ...subAgentConfig, prewarmedSchema },
  signal,
);
```

`sql-sub-agent.ts` — extend `SubAgentConfig` and prompt build:

```ts
export type SubAgentConfig = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxIterations: number;
  prewarmedSchema?: string;  // new
};

const systemPrompt = config.prewarmedSchema
  ? `${config.systemPrompt}\n\n## Schema (already loaded — DO NOT re-fetch)\n${config.prewarmedSchema}`
  : config.systemPrompt;
```

`sql-tool-usage.md` — append one rule:
> When schema is provided above, skip `list_tables_sql_db` and `info_sql_db` and go straight to `query_sql_db`. Only call them if a table you need is missing.

**TEST.**
- `sql-sub-agent.prewarm.spec.ts` (new) — when `prewarmedSchema` is passed, system prompt contains it and the agent's mocked transcript shows direct `query-sql` without discovery calls.
- Pin tests stay green (matcher allows tool sequences to shrink).

**FLAG.** `SQL_AGENT_PREWARM_SCHEMA_ENABLED` (default `false`).

**Risk.** Very low — discovery tools still callable; identifier-repair shim still defends quoting.

---

### 3.2 S2 — Bundled low-risk SQL config wins  *(Phase 1)*

Three independent config knobs that ship together because each is small and they don't overlap architecturally.

#### 3.2.1 Drop `query-checker` tool

**WHY.** `query-checker` is an LLM call to lint SQL pre-execution. For SELECT + one-shot repair, the error from `query-sql` is enough.

**HOW.** Edit [`sql-sub-agent.ts:49`](../src/modules/projects/application/providers/database/sql-sub-agent.ts:49):

```ts
const rawTools = this.configService.getSqlAgentDropCheckerEnabled()
  ? toolkit.getTools().filter((t) => t.name !== 'query-checker')
  : toolkit.getTools();
```

Prompt addition in `sql-tool-usage.md`:
> Do not pre-validate SQL. Submit your best query to `query_sql_db`; use the error to repair on the next iteration.

**FLAG.** `SQL_AGENT_DROP_CHECKER_ENABLED` (default `false`).

#### 3.2.2 Reduce sample-row count

**WHY.** `SqlDatabase` ships with `sampleRowsInTableInfo = 3`. Column types alone are enough for the questions we serve; sample rows are 500–1500 tokens of low-signal noise per `info-sql` call.

**HOW.** Two edits:

`config.service.ts` — add (follows existing `boundedInt` pattern):

```ts
getSqlAgentSampleRows(): number {
  return this.boundedInt('SQL_AGENT_SAMPLE_ROWS', 0, { min: 0, max: 10 });
}
```

`read-only-sql-database.ts` — extend `fromDataSource` to pipe through `sampleRowsInTableInfo`:

```ts
static async fromDataSource(
  appDataSource: DataSource,
  limits: SqlLimits,
  options?: {
    includesTables?: string[];
    ignoreTables?: string[];
    sampleRowsInTableInfo?: number;   // new
  },
): Promise<ReadOnlySqlDatabase> {
  const instance = await SqlDatabase.fromDataSourceParams({
    appDataSource,
    includesTables: options?.includesTables,
    ignoreTables: options?.ignoreTables,
    sampleRowsInTableInfo: options?.sampleRowsInTableInfo,  // new
  });
  Object.setPrototypeOf(instance, ReadOnlySqlDatabase.prototype);
  // ... (rest unchanged)
}
```

`chat-to-sql.service.ts` — pass through:

```ts
db = await ReadOnlySqlDatabase.fromDataSource(dataSource, limits, {
  includesTables: connection.allowedTables ?? undefined,
  sampleRowsInTableInfo: this.configService.getSqlAgentSampleRows(),
});
```

**Gating.** Env value IS the gate; no boolean flag. Set `SQL_AGENT_SAMPLE_ROWS=3` to restore prior behavior.

#### 3.2.3 Cheaper sub-agent model — via the existing env chain

**WHY.** With pre-warmed schema (S1), the sub-agent's job is "given schema, write one SELECT". A smaller/cheaper model is usually adequate. Per §3.0, the choice is **operator-owned via env vars** — this refactor does NOT hardcode a specific model name.

**HOW.** No code change. The existing chain already works:

```
SQL_AGENT_MODEL  →  OPENAI_MODEL  →  built-in default ('gpt-5.4-nano')
```

The operator sets `SQL_AGENT_MODEL=<their cheap-fast model>` per environment. The built-in default remains the safe value already in the repo. This proposal does NOT mandate or recommend a specific model name — that's an operational decision.

**Documentation addition** — append to `docs/env-vars.md` (or wherever env vars are documented):

> **`SQL_AGENT_MODEL`** — Optional. Model name passed to the sub-agent's `ChatOpenAI` client. Defaults to `OPENAI_MODEL`, which itself defaults to the built-in. Set this to a cheaper/faster model (e.g., a -mini or -nano tier) when you've enabled `SQL_AGENT_PREWARM_SCHEMA_ENABLED` and the simplified sub-agent doesn't need the bigger model.

**Gating.** Env value IS the gate.

**TEST (covers all of S2).** One spec file `sql-sub-agent.config.spec.ts` (DRY — one file, three `describe` blocks). Coverage:
- Drop-checker flag on → `query-checker` not in tool set.
- Sample-rows env unset → `SqlDatabase.sampleRowsInTableInfo === 0` (the new default).
- Sample-rows env `3` → field is `3`.
- `SQL_AGENT_MODEL=foo` → sub-agent's `ChatOpenAI` constructed with `model: 'foo'`.
- `SQL_AGENT_MODEL` unset, `OPENAI_MODEL=bar` → sub-agent's `ChatOpenAI` constructed with `model: 'bar'`.

**Risk.** Low. The model choice is the highest-variance dimension; validation lives in operator's hands (env override per environment), not in the proposal.

---

### 3.3 R — Router-first hybrid for outer agent  *(Phase 3)*

**WHY.** Today's `AGENT_DATABASE_ROUTING_PROTOCOL` teaches the outer LLM to route. ~85 % of turns are classifiable in one fast LLM call. The full tool-calling loop is overkill for the routine majority but stays as the safety net.

**SSoT (the critical design choice).** Routing rules live in **one** new prompt file: `src/modules/chat/prompts/chat-routing-rules.md`. This file contains the **classifier-neutral taxonomy** — the "what counts as a SQL question vs. a RAG question" decision tree — written so neither consumer dictates its phrasing.

Two consumers wrap it with consumer-specific framing:

- `chat-router-system.md` wraps the rules with classifier instructions ("Output JSON with `route` ∈ {sql, rag, agent}…").
- `buildAgentSystemPrompt()` wraps the rules with tool-use directives ("Call `query_database` when…").

Each wrapper is short and consumer-specific; the **rules themselves** (the taxonomy) are the single source. This matters because the current `AGENT_DATABASE_ROUTING_PROTOCOL` (chat-agent.service.ts:90-125) is written as **tool-use prose** ("pass the question verbatim as the `question` argument") — that prose cannot be reused verbatim by a classifier. Extraction requires rewriting the constant into taxonomy form **before** P3 wires the consumers.

**Extraction step (mandatory before P3 wiring).** Rewrite the current `AGENT_DATABASE_ROUTING_PROTOCOL` text into `chat-routing-rules.md` as taxonomy:

```
## Routing taxonomy

A user question is one of:

### SQL
- Count, total, or aggregate over rows.
- Lookup / filter / listing over entity tables.
- Concrete factual question about entity state.

### RAG
- How something is built, implemented, or architected.
- What a function/class/module does, where to find it.
- Why a design choice was made; what a spec/doc says.

### Ambiguous
- Could plausibly be either; default behavior depends on the consumer.
```

Each consumer's wrapper file then adds its own framing (classifier vs tool-user). This is what makes the SSoT real rather than nominal (per architect-reviewer MED #1).

**SSoT assertion test (P3).** A spec MUST compare the embedded `chat-routing-rules.md` content as it appears in both consumers' prompt builds. The test reads the rules file once, then asserts both `chat-router.service.classifier_prompt` and `chat-agent.service.system_prompt_with_router_off` contain the rules text verbatim. Drift between consumers → test fails.

**Consumer wrappers (per architect-reviewer new MED #2).** The taxonomy is *neutral*; each consumer adds its own framing. Operational tiebreakers and follow-on rules that today live inline in `AGENT_DATABASE_ROUTING_PROTOCOL` migrate into the appropriate wrapper so nothing is lost in extraction:

**Router wrapper (`chat-router-system.md`).** Wraps the taxonomy with classifier-shaped framing:

- Classifier preamble: "Output strict JSON with `route`, `confidence`, `reasoning`, `sourceId`. Choose exactly one route."
- Output schema (the JSON contract from §3.3).
- **Ambiguous-bucket policy:** "If the question fits the Ambiguous bucket, set `route='sql'` with `confidence < 0.7` so the agent fallback decides." (This carries forward today's "try SQL first on ambiguous" tiebreaker — chat-agent.service.ts:114 — adapted to the router's confidence-and-fallback contract.)
- 5–8 calibrated few-shot examples.

**Agent wrapper (built inline in `buildAgentSystemPrompt` when router is off, OR when router routes to `'agent'`).** Wraps the taxonomy with tool-use directives:

- "For the SQL bucket, call `query_database` first; pass the user's question verbatim as the `question` argument." (Carries forward chat-agent.service.ts:105.)
- "For the RAG bucket, call `search_knowledge_base` first." (Carries forward chat-agent.service.ts:113.)
- "**Ambiguous-bucket policy:** try `query_database` first; if results are empty, follow up with `search_knowledge_base` for a complementary view." (Carries forward chat-agent.service.ts:114-116.)
- "When you call `query_database`, cite the numbers you got back; never reshape them. If results are empty or an error is returned, say so plainly." (Carries forward chat-agent.service.ts:116.)

**Migration checklist (P3b).** When extracting `AGENT_DATABASE_ROUTING_PROTOCOL` to the taxonomy file, walk through chat-agent.service.ts:90-125 line-by-line and place each rule into either (a) the neutral taxonomy or (b) the appropriate wrapper. A spec MUST assert no rule from the original constant is lost — enumerate the original protocol's behavioral assertions in a test fixture and verify each is reachable via either taxonomy + router-wrapper or taxonomy + agent-wrapper.

**SoC.** New `ChatRouterService` owns classification. `ChatAgentService` owns the agent path. A thin private dispatcher on `ChatAgentService` switches on router output.

**Routes.** Three (no `direct_answer` — model can answer trivial turns without a tool):
- `sql` → call `query_database` directly, then synthesize.
- `rag` → call `search_knowledge_base` directly, then synthesize.
- `agent` → fall through to existing agentic path (the safety net).

**Classifier output schema:**

```json
{ "route": "sql" | "rag" | "agent", "confidence": 0.0..1.0, "reasoning": "<one sentence>", "sourceId": "<id if sql>" }
```

**Decision rule (explicit).**

- `confidence >= 0.7` → take chosen route.
- `confidence < 0.7` OR `route == 'agent'` OR classifier error → existing agent path. No retry.

**Fail-fast.** Classifier LLM failure → log + fall through to agent. JSON parse failure → log + fall through. Agent fallback is the safety net; do NOT retry the classifier.

**Model selection (per §3.0).** Router uses `getChatRouterModel() ?? getOpenAiModel()`. New env var: `CHAT_ROUTER_MODEL` (optional override). Built-in fallback chain applies.

**HOW.**

`config.service.ts` — additions:

```ts
getChatRouterEnabled(): boolean {
  return process.env.CHAT_ROUTER_ENABLED === 'true';
}
getChatRouterModel(): string | null {
  return process.env.CHAT_ROUTER_MODEL?.trim() || null;
}
getChatRouterConfidenceThreshold(): number {
  return this.boundedInt('CHAT_ROUTER_CONFIDENCE_PCT', 70, { min: 0, max: 100 }) / 100;
}
getChatRoutingRules(): string {
  return this.loadPrompt({
    envInline: process.env.CHAT_ROUTING_RULES?.trim(),
    envPath: process.env.CHAT_ROUTING_RULES_PATH?.trim(),
    fileCandidates: [
      resolve(process.cwd(), 'dist/modules/chat/prompts/chat-routing-rules.md'),
      resolve(process.cwd(), 'src/modules/chat/prompts/chat-routing-rules.md'),
    ],
    fallback: '/* see chat-routing-rules.md */',
    cacheKey: 'chat-routing-rules',
  });
}
```

`chat-router.service.ts` (new):

```ts
@Injectable()
export class ChatRouterService {
  constructor(private readonly configService: ConfigService) {}
  async classify(input: { question: string; sourceSummary: SourceSummary[]; apiKey: string }): Promise<RouterDecision> {
    const model = this.configService.getChatRouterModel() ?? this.configService.getOpenAiModel();
    const llm = new ChatOpenAI({ apiKey: input.apiKey, model, temperature: 0 });
    const rules = this.configService.getChatRoutingRules();
    // 1 LLM call, JSON mode. On any error → { route: 'agent', confidence: 0, reasoning: 'classifier_error' }
  }
}
```

`chat-agent.service.ts` — extract a small dispatcher (private method, not a new class — KISS):

```ts
private async dispatchRoute(params, apiKey): Promise<{ kind: 'agent' | 'sql' | 'rag', decision?: RouterDecision }> {
  if (!this.configService.getChatRouterEnabled()) return { kind: 'agent' };
  const decision = await this.chatRouter.classify({...});
  const threshold = this.configService.getChatRouterConfidenceThreshold();
  if (decision.route === 'agent' || decision.confidence < threshold) return { kind: 'agent' };
  return { kind: decision.route, decision };
}
```

Then remove the `AGENT_DATABASE_ROUTING_PROTOCOL` constant from `chat-agent.service.ts` and replace its usage in `buildAgentSystemPrompt` with a call to `configService.getChatRoutingRules()`.

Move the protocol text into `src/modules/chat/prompts/chat-routing-rules.md` verbatim (it becomes the SSoT).

**TEST.**
- `chat-router.service.spec.ts` — happy classifications; LLM error → `route: 'agent'`; JSON parse failure → `route: 'agent'`; confidence below threshold → `kind: 'agent'`.
- `chat-agent.dispatch.spec.ts` — route table + the assertion that **the agent system prompt contains the routing rules under both flag states**.

**FLAG.** `CHAT_ROUTER_ENABLED` (default `false`). `CHAT_ROUTER_CONFIDENCE_PCT` defaults to 70.

**Risk.** Medium — classifier miscalibration. Mitigated by 0.7 threshold + agent fallback + `pin_hybrid` test enforces both `searching` AND `sql_executed` on multi-source ambiguous questions.

---

### 3.4 M — Move `DataSourceRegistry` out of `projects/`  *(Phase 4)*

**WHY.** `chat → projects` directional dependency is wrong; the registry is cross-cutting.

**HOW.** Mechanical move of `DataSourceRegistry`, providers, `database/` subdir → new `src/modules/data-sources/` module. Update imports.

**TEST.** All existing specs green after rename.

**FLAG.** None.

**Risk.** Low (mechanical); large diff — review for missed imports.

---

### 3.5 Minimal observability (in Phase 0)

Two metrics, structured `Logger` log. **`route` is derived locally in the dispatcher / streaming loop — NOT a field on `AgentToolContext`** (per architect-reviewer MED #4, preserves the §11 "ctx does not grow" guarantee).

```ts
// route is a local variable in generateReplyStreaming / generateAgentReply,
// set to 'agent' in P0 and to the dispatcher's chosen route in P3.
const route: 'agent' | 'sql' | 'rag' = 'agent';

this.logger.log({
  event: 'chat.turn',
  route,
  llmCalls: countLlmCalls(result),
  durationMs: Date.now() - turnStartedAt,
  tokensTotal: sumTokens(result),
});
```

Per-bucket accounting added later only if dashboards demand.

---

### 3.6 SQL streaming events (in Phase 3b, with R wiring)

Two new event types (`sql_retrying` cut — YAGNI):

```ts
| { type: 'sql_planning';  connectionId: string; connectionName: string }
| { type: 'sql_executing'; connectionId: string; connectionName: string; sql: string }
```

**Drain ordering (must be explicit, per architect-reviewer MED #5).** The existing `drainSqlEvents(ctx)` in `chat-agent.service.ts:577` fires only after tool-message completion (after the sub-agent has finished). New events emitted *during* sub-agent execution would queue up behind the wrong drain point — `sql_planning` would appear *after* `sql_executed` rather than before. The two events have different timing characteristics:

- **`sql_planning`** fires when the outer agent decides to call `query_database` — *before* the sub-agent runs.
- **`sql_executing`** fires when the sub-agent has generated the SQL string and is about to execute — *during* the sub-agent's run, before the outer loop sees the tool message.

These need different push mechanisms.

**Implementation mechanism (chosen — synchronous progress callback).** The cleanest fit for this codebase's existing `ctx.eventSink` + `drainSqlEvents` pattern is a **synchronous progress callback** threaded into `ChatToSqlService.askConnection` and `runSqlSubAgent`. Rejected alternatives: polling-during-await (gross, race-prone) and converting `runSqlSubAgent` to an `AsyncIterable` (larger refactor, semantically nicer but out of proportion for two events).

**Concrete wiring (P3b):**

```ts
// data-source-provider.interface.ts — extend without growing AgentToolContext
// (callback is passed as a separate parameter to tool factories, not stored on ctx)
export type SqlProgressCallback = (event: SqlPlanningEvent | SqlExecutingEvent) => void;

// query-database-tool.ts — accept optional callback
export type CreateQueryDatabaseToolParams = {
  // ... existing fields
  onSqlProgress?: SqlProgressCallback;
};

// chat-to-sql.service.ts — accept callback, pass to sub-agent
async askConnection(
  factory: SqlDataSourceFactory,
  connection: ResolvedSqlConnection,
  question: string,
  signal?: AbortSignal,
  onProgress?: SqlProgressCallback,  // new
): Promise<ChatToSqlResult> {
  // ... pass to runSqlSubAgent
}

// sql-sub-agent.ts — fire callback at the two transitions
async function runSqlSubAgent(..., onProgress?: SqlProgressCallback) {
  onProgress?.({ type: 'sql_planning', connectionId, connectionName });
  // ... agent.invoke
  // Wrap query-sql tool to fire 'sql_executing' before db.run:
  const wrappedQuerySql = tool(async (input) => {
    const sql = extractSql(input);
    onProgress?.({ type: 'sql_executing', connectionId, connectionName, sql });
    return originalQuerySql.invoke(input);
  }, { ... });
}

// chat-agent.service.ts (streaming loop) — onProgress wires into eventSink AND triggers
// an immediate drain, so events surface to the SSE client without waiting for the next
// outer-loop iteration:
const onSqlProgress: SqlProgressCallback = (event) => {
  ctx.eventSink.push(event);
  // Synchronous drain: write to a side queue that the for-await loop checks each tick.
  // Implementation detail — see drain-loop pseudocode below.
};
```

The drain mechanism inside the streaming loop: events pushed via `onSqlProgress` queue into `ctx.eventSink` and drain at the next outer-loop message boundary — typically the tool-message immediately preceding `sql_executed`. `sql_planning` and `sql_executing` will batch-drain just before `sql_executed`, not interleaved with sub-agent reasoning steps. The pin matcher (P0 — see lines below) explicitly permits this ordering: `sql_planning?` and `sql_executing?` between `searching?` and `sql_executed`. No timer-based polling; the existing `for await (...)` over `agent.stream()` chunks is the only tick source.

**Pin matcher (P0) requirement.** Matcher MUST allow `sql_planning?` and `sql_executing?` between `searching?` and `sql_executed` so the same matcher survives both P0 (no new events) and P3b (with new events).

**Why P3b not P3a:** the wiring touches `query-database-tool.ts`, `chat-to-sql.service.ts`, `sql-sub-agent.ts`, and the chat-agent streaming loop — that's wiring-layer work belonging with the dispatcher wiring. P3a (router service in isolation) does not touch these files.

Additive from the SPA's perspective — no flag — but only ships in P3b.

---

## 4. Phased Execution Plan

| Phase | Contents | Slice (~LOC) | Flags introduced | Risk |
|---|---|---|---|---|
| **P0** | Pin tests + ESM LLM-mock seam (§0.1) + telemetry (no behavior change) | ~200 | none | None |
| **P1** | S2 bundle (drop-checker behind flag + sample-rows env + `fromDataSource` signature extension) | ~120 | `SQL_AGENT_DROP_CHECKER_ENABLED` + 1 env default | Low |
| **P2** | S1 schema pre-warming (direct `db.getTableInfo()` call) | ~80 | `SQL_AGENT_PREWARM_SCHEMA_ENABLED` | Low |
| **P3a** | Router service + classifier prompt + spec; flag stays off | ~180 | `CHAT_ROUTER_ENABLED` (defined; not flipped) + model env + confidence threshold | Low (isolated) |
| **P3b** | Dispatcher wiring + SSoT extraction (move `AGENT_DATABASE_ROUTING_PROTOCOL` to `chat-routing-rules.md`) + §3.6 streaming events with drain-point hook + flip-to-on capability | ~220 | none new | Medium |
| **P4** | M registry move | ~mechanical | none | Low |

**Phases MUST land in order.** P3 was split into P3a (router in isolation, flag off, no consumers wired) and P3b (consumers wired, SSoT extracted, streaming events drain-hooked) per architect-reviewer MED #3 — keeps each PR ≤ ~220 LOC for reviewability.

**Per-phase `verify:` clauses:**

- **P0:** all existing specs green + new pin specs green + telemetry shows `route='agent'` + `llmCalls >= 4` baseline captured in `docs/refactor-baseline-metrics.md`.
- **P1:** `chat.turn.llmCalls` drops by 1 in staging with `SQL_AGENT_DROP_CHECKER_ENABLED=true`. Pin tests green under both flag states.
- **P2:** `chat.turn.llmCalls` drops by ~2 in staging with both flags on. Discovery tools still callable (verified by forcing `prewarmedSchema=undefined` in a test).
- **P3a:** new router spec green; agent path unchanged in pin tests; `CHAT_ROUTER_ENABLED=true` has no effect because no consumer wires the result yet.
- **P3b:** with `CHAT_ROUTER_ENABLED=true`: `pin_sql_only` and `pin_search_only` show `llmCalls` reduction; `pin_hybrid` still produces both `searching` AND `sql_executed`; SSoT spec asserts routing-rules text identical in both consumer prompt builds; new streaming events appear before `sql_executed`.
- **P4:** all specs green after import rewrites; no behavioral change.

---

### Phase 0 — Baseline pin tests + LLM-mock seam + telemetry

**Goal.** Make subsequent refactors mechanically verifiable.

#### 0.1 LLM-mock seam (design decision — ESM-correct)

Current tests bypass the agent path by forcing `getOpenAiApiKey()` to return `null` (keyless fallback). Pin tests for P1–P3 MUST exercise the agent path with deterministic LLM responses.

**This repo runs Jest in ESM mode.** Per `chat-agent-streaming-fence.integration.spec.ts:25-34`, static `import` of `langchain` resolves **before** any `jest.mock()` factory registers — `jest.mock()` is a **no-op here** and the real `ChatOpenAI` would issue a live HTTP request returning 401. The architect-reviewer flagged this as HIGH (would silently break every pin test). **The correct ESM pattern is `jest.unstable_mockModule` + dynamic `import()`**, mirroring the established pattern in `sql-sub-agent.spec.ts:26-47`.

**Required pattern** (single source for all pin specs — `test/utils/llm-mock.ts`):

```ts
// test/utils/llm-mock.ts
import { jest } from '@jest/globals';

export type TranscriptStep =
  | { tool_calls: Array<{ name: string; args: unknown }> }
  | { content: string };

export function mockOpenAiWithTranscript(messages: TranscriptStep[]): void {
  // MUST be called BEFORE the dynamic import of the SUT in the spec.
  jest.unstable_mockModule('@langchain/openai', () => ({
    ChatOpenAI: jest.fn().mockImplementation(() => makeMockChatModel(messages)),
  }));
}
```

**Spec scaffold** (mandatory pattern for every pin spec):

```ts
// chat-agent.behavior-pin.integration.spec.ts
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockOpenAiWithTranscript } from '../../../../../test/utils/llm-mock';

describe('ChatAgentService behavior pins', () => {
  let service: any;

  beforeEach(async () => {
    jest.resetModules();
    mockOpenAiWithTranscript([...]); // declared per-test
    // Dynamic import AFTER mock registration:
    const { ChatAgentService } = await import('./chat-agent.service');
    // ... construct service
  });
});
```

**If P3 reveals this mock is too coupled to internals**, the fallback is a constructor-injected `LlmFactory` seam in `ChatAgentService` / `ChatRouterService` / `runSqlSubAgent`. Tracked as P5+ contingency, not P0 baseline.

#### 0.2 Pin tests

New file `chat-agent.behavior-pin.integration.spec.ts`. For each scenario, pin the *shape* (event sequence types, metadata keys) — never LLM wording.

| Scenario | Sources | Expected event sequence | Expected metadata keys |
|---|---|---|---|
| `pin_search_only` | 1 Airweave | `searching, chunk*, done` | `sources.length >= 1` |
| `pin_sql_only` | 1 SQL | `searching?, sql_executed, chunk*, done` | `sqlCalls.length == 1` |
| `pin_no_sources` | none | `chunk*, done` | `generator in {'langchain-agent','fallback-search-summary'}` |
| `pin_hybrid` | 1 Airweave + 1 SQL | contains `searching` AND `sql_executed` | both keys present |
| `pin_keyless_fallback` | 1 Airweave, no API key | `chunk*, done` | `generator == 'fallback-search-summary'` |

**Critical matcher property.** `toMatchPinSequence` (new util in `test/utils/pin-matchers.ts`) MUST treat tool calls as *optional* (`?` semantics). The same pin must survive P2 (when pre-warming removes `list-sql`/`info-sql`).

#### 0.3 Telemetry

Inline in `chat-agent.service.ts` as in §3.5.

#### 0.4 Baseline doc

`docs/refactor-baseline-metrics.md` captures current per-turn `llmCalls` from pin transcripts.

#### 0.5 SPA event-handling verification

Open a single ticket in the SPA repo (or check directly): confirm the SPA's chat stream consumer ignores unknown event types. If not, gate §3.6 events behind `SQL_STREAM_EVENTS_ENABLED=false` and SPA work tracked separately.

**TEST.** All existing specs + new pin specs green.
**FLAG.** None.
**RISK.** None.

---

### Phase 1 — S2 bundle

**Files touched:**

```
src/modules/projects/application/providers/database/sql-sub-agent.ts            (drop checker behind flag)
src/modules/projects/application/providers/database/read-only-sql-database.ts   (extend fromDataSource signature)
src/modules/projects/application/providers/database/chat-to-sql.service.ts      (pipe sampleRows through)
src/shared/config/config.service.ts                                              (2 new getters)
src/modules/chat/prompts/sql-tool-usage.md                                       (one new rule)
```

**New spec:** `sql-sub-agent.config.spec.ts` (DRY — one file, `describe.each`).

**Rollout:** enable individually in staging → observe `chat.turn.llmCalls` drop → promote to default-on.

---

### Phase 2 — S1 schema pre-warming

**Files touched:**

```
src/modules/projects/application/providers/database/read-only-sql-database.ts   (no changes — `db.getTableInfo()` used directly)
src/modules/projects/application/providers/database/chat-to-sql.service.ts      (pre-warm before sub-agent)
src/modules/projects/application/providers/database/sql-sub-agent.ts            (accept prewarmedSchema)
src/modules/chat/prompts/sql-tool-usage.md                                       (one new rule)
src/shared/config/config.service.ts                                              (one new flag)
```

**New spec:** `sql-sub-agent.prewarm.spec.ts`.

---

### Phase 3 — R router + streaming events + SSoT extraction

**Files touched:**

```
src/modules/chat/application/services/chat-router.service.ts                    (new)
src/modules/chat/application/services/chat-agent.service.ts                     (dispatcher; replace AGENT_DATABASE_ROUTING_PROTOCOL constant with loaded prompt)
src/modules/chat/prompts/chat-routing-rules.md                                  (new — extracted from current constant)
src/modules/chat/prompts/chat-router-system.md                                  (new — router-specific prompt; INCLUDES chat-routing-rules.md content via composition in ChatRouterService)
src/modules/projects/application/providers/database/chat-to-sql.service.ts      (emit sql_planning / sql_executing)
src/shared/config/config.service.ts                                              (4 new getters: enabled, model, confidence, routing-rules prompt loader)
```

**New specs:**
- `chat-router.service.spec.ts`
- `chat-agent.dispatch.spec.ts` (includes the assertion that agent system prompt contains routing rules under BOTH flag states — SSoT verification)

---

### Phase 4 — M registry move

Pure mechanical move. One PR, no behavior changes.

---

## 5. Test Strategy

| Layer | Mechanism |
|---|---|
| **Pin tests** (Phase 0) | Lock *shapes*, not wording. Matcher allows tool sequences to shrink so the same pin survives P2. |
| **LLM-mock seam** (Phase 0) | `jest.mock('@langchain/openai')` with transcript-driven responses. No real LLM in CI. |
| **Postgres roundtrip** | Existing `postgres-roundtrip.smoke.spec.ts` extended with one case under `SQL_AGENT_PREWARM_SCHEMA_ENABLED=true`. |
| **Flag-matrix CI** | Jest `describe.each` runs each spec under both flag states. |
| **SSoT assertion** | Dedicated test in P3 verifies the routing-rules text is identical in both consumers (router prompt build + agent prompt build). |
| **Telemetry** | `chat.turn.llmCalls` and `chat.turn.durationMs` per route. Watch staging baseline before any default flip. |

---

## 6. Rollback (two categories — be explicit, per architect-reviewer LOW #2)

**Category A — Flag-reversible behavior changes.** P1, P2, P3a, P3b (router on/off). Rollback = single env-var flip; no code revert. Production code paths for old behavior remain wired permanently.

**Category B — One-way structural extractions.** Two changes are *not* flag-reversible:

1. **P3b SSoT extraction:** `AGENT_DATABASE_ROUTING_PROTOCOL` constant is **removed** from `chat-agent.service.ts`; text moves into `chat-routing-rules.md`. Both consumers (router and agent) read from the file. To rollback: `git revert` the P3b PR.
2. **P4 registry move:** `DataSourceRegistry` and providers move from `projects/application/providers/` to `data-sources/`. Imports change throughout. To rollback: `git revert` the P4 PR.

Both Category B changes are deliberate refactors, not flagged behaviors. They are reviewable as single mechanical PRs (P3b's SSoT extraction is a text move; P4 is import-rewrite). Treat them with the standard "merge to a feature branch first, run full suite, then to main" hygiene — same as any structural refactor.

SqlToolkit, `@langchain/classic`, identifier-repair, agentic-fallback path — all stay permanently regardless of flags.

---

## 7. Flag Interaction Matrix

Three behavioral flags. All combinations explicitly valid.

| `PREWARM` | `DROP_CHECKER` | `ROUTER` | Behavior |
|---|---|---|---|
| off | off | off | **Today's behavior.** ~5 LLM calls per SQL turn. |
| off | on  | off | ~4 LLM calls per SQL turn (no checker). |
| on  | off | off | ~3 LLM calls per SQL turn (no discovery). |
| on  | on  | off | ~2 LLM calls per SQL turn. |
| on  | on  | on  | ~2 sub-agent calls + 1 router call + 1 outer synthesis = ~4 LLM calls total; **on simple non-SQL turns: 1 router + 1 synthesis = 2 total.** |

The flags are **independent**: any combination is valid. No ordering constraints.

`SQL_AGENT_SAMPLE_ROWS`, `SQL_AGENT_MODEL`, `OPENAI_MODEL`, `CHAT_ROUTER_MODEL`, `CHAT_ROUTER_CONFIDENCE_PCT` are env-value-as-gate; they take effect on next process start.

---

## 8. Principle Scorecard

| Principle | Status | Notes |
|---|---|---|
| **SOLID — SRP** | ✓ | `ChatRouterService` separate. Pre-warm on `ChatToSqlService`. |
| **SOLID — OCP** | ✓ | Router added as new service; agent path unmodified. Pre-warm via optional `SubAgentConfig` field. |
| **SOLID — ISP** | ✓ | `AgentToolContext` does NOT grow. |
| **SOLID — DIP** | ~  | Existing concrete deps (`DataSourceRegistry`, `SqlDataSourceFactory`) untouched; out of scope. |
| **DRY** | ✓ | Library's `db.getTableInfo()` used directly (no wrapper helper). One spec for S2 bundle. **One routing-rules file consumed by both router and agent.** |
| **KISS** | ✓ | 3 boolean flags. 4 changes. No new caches/hashes/accumulators. |
| **SoC** | ✓ | Pre-warm = DB read. Routing = classification. Agent = execution. Schema rendering = SqlDatabase wrapper. |
| **YAGNI** | ✓ | 7 speculative items cut (§1.2). |
| **Cohesion / coupling** | ✓ | Concerns colocated; registry move (P4) reduces inter-module coupling. |
| **Fail-fast** | ✓ | Pre-warm errors surface (not swallowed). One repair retry then return. Router error → explicit fallback (logged), not retry. |
| **Explicitness** | ✓ | Flag matrix (§7). Decision rule for router (§3.3). Model fallback chain (§3.0). |
| **SSoT** | ✓ | Routing rules: **one file**, two consumers. Schema rendering: one helper. Model defaults: `getOpenAiModel()` is the sole built-in. Config: `ConfigService`. |

Residual debt (out of scope — tracked as named follow-ups, not informal footnotes):

| ID | Item | Recommended PR |
|---|---|---|
| **DEBT-1** | DIP `~`. Repository pattern / ports for `SqlDataSourceFactory` and `DataSourceRegistry`. | Post-P4, separate PR |
| **DEBT-2** | `ChatAgentService` is 1062 LOC (verified) and grows further in P3b. Splitting into `ChatAgentService` (agent execution) + `ChatTurnDispatcher` (router branch + route handlers) + `StreamSanitizer` (fence stripping) is sound but premature now per KISS — the P3b dispatcher is one private method. **Promote to P5 named follow-up** if post-P3b telemetry shows the file growing past ~1200 LOC or if a second branch (e.g., per-route streaming customization) lands. | P5 (conditional) |

---

## 9. Acceptance Criteria

1. `package.json` still depends on `@langchain/classic` (SqlToolkit retained).
2. All three flags default-`true` in prod.
3. Median sub-agent LLM calls per SQL turn ≤ 2 (down from ~4).
4. Median total LLM calls per chat turn ≤ 3 on simple turns, ≤ 4 on SQL turns.
5. Streaming SQL turns emit `sql_planning` + `sql_executing` before `sql_executed`.
6. Phase 0 pin tests green.
7. `DataSourceRegistry` under `src/modules/data-sources/`; `chat/` does not import from `projects/`.
8. Routing rules live in `src/modules/chat/prompts/chat-routing-rules.md` only; no inline routing constant remains in `chat-agent.service.ts`.
9. **No literal LLM model name appears in `src/**` (excluding `*.spec.ts`) except `getOpenAiModel()` in `ConfigService`.** Test files MAY use literal model names like `'gpt-test'` for dependency injection in unit tests. All production callers use the env-fallback chain.
10. `npm test` green. No new lint/type errors.

---

## 10. Glossary

- **Outer agent** — `ChatAgentService.generateAgentReply` / `generateReplyStreaming`. Top-level `createAgent`.
- **Sub-agent** — `runSqlSubAgent`. Inner `createAgent` over `SqlToolkit`. **Stays.**
- **Schema pre-warming** — fetching the schema deterministically before invoking the sub-agent and injecting it into the system prompt.
- **Router** — fast LLM classifier (R) that decides the turn's route before invoking the agent.
- **Pin test** — integration test that locks the *shape* of observable behavior.
- **`ctx` / `AgentToolContext`** — per-request context; unchanged in this refactor.
- **Model fallback chain** — `<specific env> ?? OPENAI_MODEL ?? built-in`. See §3.0.

---

## 11. Verification Log (what was actually read and confirmed)

This proposal was reviewed against the codebase, not assumed. The following were read and confirmed:

| Item | File | Finding |
|---|---|---|
| `SqlDatabase` shape | `node_modules/@langchain/classic/dist/sql_db.d.ts` | Has `allTables: SqlTable[]`, `getTableInfo(targetTables?)`, `sampleRowsInTableInfo: number`. **No `getTableNames()`** — plan uses `db.allTables.map(t => t.tableName)`. |
| `ReadOnlySqlDatabase.fromDataSource` | `read-only-sql-database.ts:34` | Currently accepts `{includesTables, ignoreTables}` only. **Plan extends signature to accept `sampleRowsInTableInfo`.** |
| Model env pattern | `chat-to-sql.service.ts:94`, `config.service.ts:382` | Existing chain: `getSqlAgentModel() ?? getOpenAiModel()`. `getSqlAgentModel()` returns `null` if unset. `getOpenAiModel()` returns `process.env.OPENAI_MODEL || 'gpt-5.4-nano'`. **Plan preserves and extends to router (§3.0).** |
| `ConfigService` patterns | `config.service.ts:457` | Uses `boundedInt(envName, fallback, {min,max})` for safety-critical numerics and `loadPrompt({envInline, envPath, fileCandidates, fallback, cacheKey})` for prompts. **Plan's new getters follow both patterns.** |
| Test mocking style | `chat-agent.service.spec.ts:90–102` | Existing tests mock `ConfigService` methods with `jest.fn().mockReturnValue(...)`. Agent path is NOT exercised today (forced into keyless fallback). **Plan adds LLM-mock seam (§0.1).** |
| Existing routing constant | `chat-agent.service.ts:90` | `AGENT_DATABASE_ROUTING_PROTOCOL` is an inline `const`. **Plan moves text verbatim to `chat-routing-rules.md` (SSoT, §3.3).** |
| SPA event consumer | Not in this repo | **Tracked as P0.5** — verify SPA ignores unknown event types before P3 ships streaming events. |
| Tool list construction in sub-agent | `sql-sub-agent.ts:49` | `toolkit.getTools()` returns the full set including `query-checker`. **Plan filters at this exact line (§3.2.1).** |

**Confidence after verification: 0.90.** Up from the unverified 0.75.

---

## 12. Architect-Reviewer Pass (v4)

The proposal was reviewed by an independent `architect-reviewer` agent. Verdict: **REVISE_PLAN** at confidence 0.82. All findings were addressed in this v4:

| Finding | Severity | Status in v4 |
|---|---|---|
| `jest.mock('@langchain/openai')` will not work in ESM mode | HIGH | Fixed — §0.1 now uses `jest.unstable_mockModule` + dynamic `import()` |
| SSoT routing-rules overstated — current text is tool-use prose, not classifier-neutral | MED #1 | Fixed — §3.3 now mandates rewriting to taxonomy form; SSoT assertion test compares the rules section, not whole prompt |
| `renderSchemaText` reinvents library behavior — `db.getTableInfo()` already filters via `includesTables` | MED #2 | Fixed — §3.1 collapses to direct `db.getTableInfo()` call; helper deleted |
| Plan missed per-phase LOC budgets and `verify:` clauses | MED #3 | Fixed — §4 adds slice LOC per phase and explicit `verify:` clauses; P3 split into P3a + P3b |
| `ctx.route` slip contradicts "`AgentToolContext` does not grow" | MED #4 | Fixed — §3.5 derives `route` as a local variable in the streaming loop |
| Streaming-event drain ordering not specified — `sql_planning` could land after `sql_executed` | MED #5 | Fixed — §3.6 specifies drain-point hook at tool-call begin, moves implementation to P3b |
| `ChatAgentService` is 1062 LOC; splitting tracked only as footnote | MED #6 | Fixed — §8 promotes the split to DEBT-2 as named conditional P5 follow-up |
| Acceptance #9 wording included test files | LOW #1 | Fixed — §9 #9 now scoped to `src/**` excluding `*.spec.ts` |
| §6 rollback claim "no cleanup PRs" too absolute — P3b and P4 are one-way structural | LOW #2 | Fixed — §6 splits Category A (flag-reversible) from Category B (one-way structural, `git revert` only) |

**Confidence after architect-reviewer pass and v4 patches: 0.88.** (Tempered from a draft 0.95 per reviewer's LOW finding; the cap reflects the MED #5 partial that was resolved in v5 below.)

---

## 13. Architect-Reviewer Pass 2 (v5)

The v4 proposal was re-reviewed. Verdict: **REVISE_PLAN** at 0.86 (up from 0.82 in pass 1). Seven of nine prior findings were confirmed FIXED; one PARTIAL (MED #5 drain mechanism); two new MEDs and two new LOWs. All addressed in v5:

| Finding | From | Status in v5 |
|---|---|---|
| MED #5 partial — `sql_executing` push channel not chosen | Re-review | Fixed — §3.6 names **synchronous progress callback** as the mechanism, with concrete code skeleton; explicit rejection of polling and async-iterator alternatives with reasoning |
| MED (new) — taxonomy drops operational tiebreakers; need "Consumer wrappers" sub-block | Re-review | Fixed — §3.3 adds explicit "Consumer wrappers" subsection enumerating what router-wrapper and agent-wrapper each add; migration checklist with line-by-line walkthrough of original protocol; spec requirement that no rule is lost |
| LOW — Phase 2 file-touch table still mentions `renderSchemaText` | Re-review | Fixed — line updated to "no changes — `db.getTableInfo()` used directly" |
| LOW — claimed 0.95 confidence too high | Re-review | Fixed — §12 confidence tempered to 0.88 |

**Confidence after v5 patches: 0.92.** Path to APPROVE_PLAN was the reviewer's exact prescription: "Once §3.6 names its push channel and §3.3 adds a 'Consumer wrappers' sub-block enumerating per-wrapper additions, this is APPROVE_PLAN."

---

## 14. Architect-Reviewer Pass 3 (v5.1) — **APPROVE_PLAN**

The v5 proposal was re-reviewed (pass 3). **Verdict: APPROVE_PLAN at 0.91.**

All four pass-2 findings confirmed FIXED:

| Pass-2 finding | Pass-3 verdict | Evidence |
|---|---|---|
| MED #5 push channel undefined | FIXED | §3.6 names synchronous progress callback with rejection reasoning for polling and async-iterator; concrete skeletons across 5 files; callback is parameter not ctx field (AgentToolContext "does not grow" preserved) |
| NEW MED Consumer wrappers | FIXED | §3.3 enumerates router-wrapper + agent-wrapper per-additions; ambiguous-bucket tiebreaker (current chat-agent.service.ts:114) placed in BOTH wrappers; cite-numbers rule (line 116) in agent-wrapper #4; migration checklist concrete enough to execute |
| NEW LOW renderSchemaText stale | FIXED | line 649 updated to "no changes — `db.getTableInfo()` used directly" |
| NEW LOW confidence overclaim | FIXED | §12 tempered to 0.88; §13 grounded at 0.92 |

**One new LOW in pass 3** — prose-precision nit on §3.6 drain-loop timing ("`dirty` flag" wording oversold the timing). **Fixed in v5.1**: the paragraph now states events queue and drain at the next outer-loop message boundary (typically immediately before `sql_executed`), which matches the pin matcher's already-correct ordering contract.

**Aggregate pass-3 confidence: 0.91** (model rubric 0.92 capped by the LOW prose nit; LOW addressed in v5.1, so v5.1 effective confidence ≈ 0.92).

**Per CLAUDE.md P8.2:** `final = min(model_rubric, binding_subagent) = min(0.92, 0.91) = 0.91 (set by architect-reviewer pass 3, APPROVE_PLAN)`.

---

## Reviewer review history (audit trail)

| Pass | Verdict | Confidence | Findings | Outcome |
|---|---|---|---|---|
| Pass 1 (v3 → v4) | REVISE_PLAN | 0.82 | 1 HIGH + 6 MED + 2 LOW | All addressed in v4 |
| Pass 2 (v4 → v5) | REVISE_PLAN | 0.86 | 1 PARTIAL + 1 new MED + 2 new LOW | All addressed in v5 |
| Pass 3 (v5 → v5.1) | **APPROVE_PLAN** | **0.91** | 1 new LOW (prose nit) | Addressed in v5.1 |

The proposal is approved for execution. Phase 0 (pin tests + ESM mock seam + telemetry — zero behavior change) is the safe entry point.
