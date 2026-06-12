# Chat Agent Tuning Guide

Settings are configured through environment variables in `.env` and take
effect on the next server restart. Tuning knobs have defaults, but
`OPENAI_API_KEY` is a startup requirement in the current application because
the vector embedding adapter is constructed unconditionally.

## Quick reference

| Env var | Default | What it controls |
|---|---|---|
| `OPENAI_API_KEY` | *(required)* | OpenAI API key used by chat models and vector embeddings. |
| `OPENAI_MODEL` | `gpt-5.4-nano` | The OpenAI model used for the agent. |
| `CHAT_SYSTEM_PROMPT` | *(from file)* | Inline system prompt override (highest priority). |
| `CHAT_SYSTEM_PROMPT_PATH` | *(from file)* | Path to a `.md` file containing the system prompt. |
| `CHAT_AGENT_MAX_ITERATIONS` | `5` | Max tool-calling iterations per request. |
| `CHAT_AGENT_TOOL_RESULT_LIMIT` | `12` | Airweave results fetched per tool call. |
| `CHAT_AGENT_TOOL_RESULT_CHAR_CAP` | `3000` | Max characters per result excerpt sent to the LLM. |
| `CHAT_AGENT_MAX_SOURCES` | `15` | Max unique sources in the response metadata. |
| `CHAT_AGENT_HISTORY_WINDOW` | `6` | Number of previous conversation messages included. |
| `CHAT_AGENT_SEARCH_TIER` | `classic` | Airweave search tier: `classic` or `instant`. |
| `CHAT_AGENT_RETRIEVAL_STRATEGY` | *(Airweave default)* | Retrieval strategy: `semantic`, `keyword`, or `hybrid`. |
| `VECTOR_DB_MIN_SCORE_PCT` | `30` | Minimum cosine-similarity percentage for Velocity vector-database chunks; `0` disables the floor. |
| `CHAT_RATE_LIMIT_TTL` | `60000` | Rate limit window in milliseconds. |
| `CHAT_RATE_LIMIT_MAX` | `20` | Max requests per rate limit window per user. |
| `CHAT_ROUTER_ENABLED` | `false` | Enable direct SQL/RAG route classification. |
| `CHAT_ROUTER_MODEL` | `OPENAI_MODEL` | Optional low-cost classifier model. |
| `CHAT_ROUTER_CONFIDENCE_PCT` | `70` | Confidence required for direct dispatch. |
| `SQL_AGENT_MODEL` | `OPENAI_MODEL` | Optional model for the inner SQL agent. |
| `SQL_AGENT_MAX_ITERATIONS` | `8` | SQL toolkit/repair iteration budget. |
| `SQL_AGENT_PREWARM_SCHEMA_ENABLED` | `false` | Load allowed schema before the SQL agent starts. |
| `SQL_AGENT_DROP_CHECKER_ENABLED` | `false` | Remove the extra query-checker model call. |

## Detailed settings

### CHAT_ROUTER_ENABLED

**Default**: `false`

When enabled, a small classifier labels each question `sql`, `rag`, or `agent`.
Confident SQL/RAG classifications invoke the corresponding tool directly and
save the outer agent's tool-selection model call. Invalid output, classifier
errors, low confidence, and `agent` classifications use the existing general
agent path.

Use `CHAT_ROUTER_MODEL` to select a smaller classifier model and
`CHAT_ROUTER_CONFIDENCE_PCT` to tune direct dispatch. A higher threshold favors
the flexible agent path; a lower threshold favors latency and cost.

### SQL sub-agent controls

Database questions use an inner LangChain SQL agent. The main tuning controls
are:

- `SQL_AGENT_MODEL`: separate the SQL planning model from the answer model.
- `SQL_AGENT_MAX_ITERATIONS`: cap schema inspection, query, and repair steps.
- `SQL_AGENT_PREWARM_SCHEMA_ENABLED=true`: deterministically load the allowed
  schema before the agent starts, usually saving discovery model calls.
- `SQL_AGENT_DROP_CHECKER_ENABLED=true`: remove the toolkit's extra
  query-checker model call and rely on execution errors for repair.
- `SQL_AGENT_SAMPLE_ROWS=0`: omit sample rows from schema inspection to reduce
  prompt size.

Safety/resource knobs such as statement timeout, maximum rows, bytes, SQL
length, and pool size are documented in
[`deployment-and-operations.md`](./deployment-and-operations.md). Do not relax
them solely to improve answer completion.

### CHAT_AGENT_MAX_ITERATIONS

**Default**: `5`

Controls how many times the agent can call the `search_knowledge_base` tool before it must synthesize an answer. Each iteration is one search query + one LLM reasoning step.

- **Raise to 7-8** if answers feel incomplete on complex multi-topic questions, or if the log shows `toolCallCount` frequently hitting the cap.
- **Lower to 2-3** if latency is more important than depth (each iteration adds ~2-4 seconds).
- **Impact**: directly affects latency and token cost. More iterations = better coverage but slower and more expensive.

### CHAT_AGENT_TOOL_RESULT_LIMIT

**Default**: `12`

How many results Airweave returns per tool call. After retrieval, results are deduped by entity (keeping the highest-relevance chunk per entity), so the agent may see fewer distinct entities than this number.

- **Raise to 15-20** if the indexed corpus has many overlapping chunks and you want more diverse material to survive deduplication.
- **Lower to 5-8** if token costs are a concern or if the LLM gets confused by too much context.
- **Impact**: more results = more diverse context but more tokens per tool call.

### CHAT_AGENT_TOOL_RESULT_CHAR_CAP

**Default**: `3000`

Maximum characters per result excerpt. Long Airweave chunks (e.g. full Confluence pages at 6k+ chars) are truncated to this limit before being sent to the LLM.

- **Raise to 5000-6000** if answers feel under-grounded on long documents, or you see the agent citing the introduction of a page but missing the substance.
- **Lower to 1000-1500** if token costs are a concern or if you have many short, self-contained documents.
- **Impact**: higher cap = more substance per result but fewer results fit in the LLM context window.

### CHAT_AGENT_MAX_SOURCES

**Default**: `15`

Maximum number of unique sources included in the response metadata (the "Sources" list rendered below each assistant message in the UI). Sources are deduped by entity and sorted by relevance.

- **Raise** if you want more comprehensive source attribution.
- **Lower** if the sources list feels too long or cluttered.
- **Impact**: UI only. Does not affect the agent's reasoning or the quality of the answer.

### CHAT_AGENT_HISTORY_WINDOW

**Default**: `6`

Number of previous conversation messages (user + assistant turns) included in the agent's context. Enables multi-turn conversations where the user can ask follow-up questions.

- **Raise to 10-20** for longer multi-turn conversations where context from earlier messages matters.
- **Lower to 2-4** if token costs are a concern or conversations are mostly single-turn.
- **Set to 0** to disable conversation history entirely (each message is treated independently).
- **Impact**: more history = better follow-up understanding but more tokens per request.

### CHAT_AGENT_SEARCH_TIER

**Default**: `classic`

Airweave search tier. Controls the tradeoff between retrieval accuracy and speed.

| Value | Behavior |
|---|---|
| `classic` | Higher accuracy, slower. Best for quality answers. **Recommended.** |
| `instant` | Lower accuracy, faster. Use only if latency is critical and you accept lower retrieval quality. |

- **Impact**: affects retrieval quality, not the LLM's reasoning. Bad retrieval = bad answers regardless of how good the LLM is.

### CHAT_AGENT_RETRIEVAL_STRATEGY

**Default**: *(unset — uses Airweave's default)*

Airweave retrieval strategy. Controls how queries are matched against indexed content.

| Value | Behavior |
|---|---|
| `semantic` | Dense vector similarity. Best for natural-language questions. |
| `keyword` | Traditional keyword matching. Best for exact terms, identifiers, file names. |
| `hybrid` | Combines semantic and keyword. Often the best general-purpose choice. |
| *(unset)* | Uses Airweave's default (typically semantic). |

- **Try `hybrid`** if semantic retrieval misses results that contain the exact terms the user asked about.
- **Try `keyword`** if the user frequently asks about specific identifiers, file names, or error codes.
- **Impact**: significantly affects what the agent finds. Experiment with your actual data before changing in production.

### VECTOR_DB_MIN_SCORE_PCT

**Default**: `30`

Velocity-managed vector databases filter Qdrant hits below this cosine
similarity percentage before sending context to the model or displaying source
citations.

- **Raise it** when unrelated documents appear as citations or weak chunks
  distract synthesis.
- **Lower it** when valid paraphrases or terminology variants disappear.
- **Set it to `0`** only when intentionally disabling relevance filtering.
- **Impact**: changes both answer context and citation visibility for
  `vector_db` sources; it does not affect Airweave retrieval.

## Tuning for "more context" (richer, longer answers)

If answers feel thin or limited, adjust these settings in combination:

1. **`CHAT_AGENT_TOOL_RESULT_LIMIT=15`** — more diverse results per search.
2. **`CHAT_AGENT_TOOL_RESULT_CHAR_CAP=5000`** — longer excerpts per result.
3. **`CHAT_AGENT_MAX_ITERATIONS=7`** — more search passes for multi-topic questions.
4. **`CHAT_AGENT_MAX_SOURCES=20`** — more sources in the UI attribution.

## Tuning for speed / lower cost

If latency or token cost is a priority:

1. **`CHAT_AGENT_MAX_ITERATIONS=2`** — fewer search passes, faster answers.
2. **`CHAT_AGENT_TOOL_RESULT_LIMIT=5`** — fewer results per search.
3. **`CHAT_AGENT_TOOL_RESULT_CHAR_CAP=1500`** — shorter excerpts.
4. **`CHAT_AGENT_SEARCH_TIER=instant`** — faster but less accurate retrieval.
5. **`CHAT_AGENT_HISTORY_WINDOW=2`** — less conversation context.

## Safe Production Tuning Workflow

Do not tune from a few anecdotal conversations. Maintain a representative,
versioned question set for each production domain and capture:

- expected execution lane and source/connection;
- required evidence or SQL result;
- acceptable answer and refusal characteristics;
- prompt-injection and sensitive-output cases;
- maximum latency and cost;
- current model, prompt, retrieval, and schema versions.

For each tuning change:

1. run the baseline with unchanged settings;
2. change one variable or one coherent group;
3. compare correctness, evidence, refusals, latency, and cost;
4. inspect failures rather than averaging them away;
5. roll back when a critical case regresses.

The current feature line includes `rag-benchmark/REPORT.md`, a synthetic
100-question run over six fictional-company documents. The June 11, 2026 run
reported 90% strict and 96% lenient answer accuracy, 88% document hit@1, 95%
hit@3, 6.3-second average latency, and 8.0-second p95 latency. Use it as a
repeatable engineering baseline, not as a substitute for a customer-domain
golden set. The production owner remains responsible for domain data, refusal
and injection cases, SQL routing, cost thresholds, and release criteria.

## Observability

Every chat request logs a summary line:

```
[ChatAgentService] reply generated {
  generator: 'langchain-agent',
  sourceCount: 8,
  resultCount: 8,
  toolCallCount: 3,
  durationMs: 12450
}
```

The logged token and LLM-call fields are operational estimates, not
billing-grade accounting. SQL sub-agent internal calls and provider costs are
not fully represented, and usage is not currently attributed to tenant budgets.

Each tool call also logs its own diagnostic:

```
[chat-agent-tools] search_knowledge_base called {
  collectionId: '...',
  query: '...',
  searchTier: 'classic',
  retrievalStrategy: 'default',
  rawResultCount: 12,
  dedupedResultCount: 7,
  resultNames: [...],
  entityTypes: [...]
}
```

Use these to diagnose tuning issues:

| Signal | Likely cause | Suggested adjustment |
|---|---|---|
| `toolCallCount` consistently = 1 | Agent not exploring enough | Raise `MAX_ITERATIONS`, check system prompt |
| `toolCallCount` = `MAX_ITERATIONS` | Agent hitting the cap | Raise `MAX_ITERATIONS` to 7-8 |
| `rawResultCount` >> `dedupedResultCount` | Many duplicate chunks | Raise `TOOL_RESULT_LIMIT` so more diverse entities survive dedup |
| `durationMs` > 20000 | Too many iterations or slow model | Lower `MAX_ITERATIONS`, try `gpt-5.4-nano` if using a larger model |
| `sourceCount` = 0 | Airweave has nothing for these queries | Check what's indexed; try `hybrid` retrieval strategy |
