# Chat Agent Tuning Guide

All settings are configured via environment variables in `.env`. Every setting has a sensible default and is optional. Changes take effect on the next server restart.

## Quick reference

| Env var | Default | What it controls |
|---|---|---|
| `OPENAI_API_KEY` | *(required)* | OpenAI API key. When unset, chat falls back to raw search excerpts. |
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
| `CHAT_RATE_LIMIT_TTL` | `60000` | Rate limit window in milliseconds. |
| `CHAT_RATE_LIMIT_MAX` | `20` | Max requests per rate limit window per user. |

## Detailed settings

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
