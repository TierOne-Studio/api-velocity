# Refactor Baseline Metrics

**Captured:** Phase 0 of `docs/langchain-agent-refactor-proposal.md`
**Source:** pin-test transcripts (`src/modules/chat/application/services/chat-agent.behavior-pin.integration.spec.ts`) + telemetry emitted by `ChatAgentService.recordTurnMetrics` (chat-agent.service.ts).
**Purpose:** establish the pre-refactor baseline so P1 / P2 / P3 wins are measurable, not anecdotal.

## Per-turn LLM-call counts (from pin transcripts)

These are the counts the pin tests were authored against. Each row is "what the outer chat agent observes today" — what `chat.turn.llmCalls` would log under the canonical telemetry. Production traffic may vary by ±1 depending on whether the agent re-queries.

| Pin scenario | Outer-agent LLM calls | Sub-agent LLM calls (NOT in telemetry today) | Total LLM calls per turn |
|---|---|---|---|
| `pin_search_only` | 2 (1 tool decision + 1 synthesis) | 0 | **2** |
| `pin_sql_only` | 2 (1 tool decision + 1 synthesis) | 3–4 (list-sql → info-sql → query-sql → optional repair) | **~5** |
| `pin_no_sources` | 1 (synthesis only) | 0 | **1** |
| `pin_hybrid` | 3 (search call + db call + synthesis) | 3–4 | **~6** |
| `pin_keyless_fallback` | 0 (no LLM call; raw search summary) | 0 | **0** |

## What the P0 telemetry can and cannot see

**Visible in `chat.turn.llmCalls` today (P0):** outer-agent LLM calls only. Computed as `metadata.toolCallCount + 1` in `recordTurnMetrics` (chat-agent.service.ts).

**INVISIBLE in `chat.turn.llmCalls` today (P0):** sub-agent calls inside `query_database`. The outer agent sees a single tool message; what the sub-agent did inside is opaque at this layer.

**Implication for the refactor's success metric.**

- **P1** (drop `query-checker` + sample-rows + cheaper model) → reduces sub-agent calls. **Will NOT move the P0 metric.** Validation: per-turn duration drops; OpenAI dashboard shows fewer sub-agent calls; pin tests stay green. Add a one-shot manual check via SQL_AGENT_MODEL override + staging timing.
- **P2** (schema pre-warming) → drops 2 sub-agent LLM calls (no more `list-sql` / `info-sql` on typical turns). **Will NOT move the P0 metric.** Same validation strategy as P1.
- **P3a** (router service in isolation, flag off) → adds 1 LLM call (router classifier) but no consumer wires it. **P0 metric should be UNCHANGED** under `CHAT_ROUTER_ENABLED=false`.
- **P3b** (dispatcher wiring + router on) → reduces outer-agent calls by 1 in the common case (router replaces tool-decision LLM call with a single classifier call). **WILL move the P0 metric down by ~1.**

**Enriching the metric.** Per proposal §3.5: *"Per-bucket accounting added later only if dashboards demand."* If observability of sub-agent calls becomes important before that, the cheapest mechanism is threading the `onSqlProgress` callback (specified in §3.6) with a `bucket: 'sql_planning' | 'sql_executing'` field that increments a counter on the chat-agent side, then logged at end-of-turn. Not in P0 scope.

## Confidence in baseline numbers

The transcript-derived numbers above are **lower bounds**:

- `pin_sql_only` sub-agent count of 3–4 reflects the default SqlToolkit loop: `list-sql` (1) → `info-sql` (1) → `query-sql` (1), plus `query-checker` (often 1) and possibly 1 repair retry. Variable per question.
- Production telemetry may show drift if `CHAT_AGENT_MAX_ITERATIONS` is raised or if the agent re-queries for clarification.

For the refactor's success criteria (proposal §9 #3 and #4), use **median over a representative production sample**, not pin-test values. Pin tests verify behavioral correctness; they are not load-tested for distribution.

## What to watch in staging after each phase

| Phase | Watch | Expected delta (median over ≥100 turns) |
|---|---|---|
| P1 | sub-agent timing (OpenAI dashboard, or add timing log in `runSqlSubAgent`) | −15% to −25% per SQL turn |
| P2 | same as P1 | additional −30% to −50% |
| P3a | `chat.turn.llmCalls` distribution | unchanged |
| P3b | `chat.turn.llmCalls` distribution + `chat.turn.route` distribution | −1 LLM call per turn on common cases (sql/rag); `route` no longer always `'agent'` |
| P4 | nothing behavior-related | tests still green |
