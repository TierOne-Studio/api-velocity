Ask a natural-language question of a project's attached SQL database. An inner read-only SQL sub-agent will inspect the schema, translate your question into a single Postgres `SELECT`, execute it under a read-only transaction with a short statement timeout, and return the resulting rows.

## When to use

- The user is asking for **facts, counts, aggregates, or specific rows** that live in the attached database (e.g. "how many orders last week", "who are our top customers", "find the order with id 123").
- The question names entities that clearly match database tables (orders, users, products, transactions, events, etc.).

## When NOT to use

- The question is about **unstructured content** (docs, specs, code, tickets) — use `search_knowledge_base` instead.
- The question is **conversational or meta** (greetings, clarifications, questions about the assistant itself).
- The user asks to **change, delete, or insert** data. This tool is read-only and the database will reject writes. Tell the user plainly that this tool cannot modify data.

## Input

- `question` (required): the user's question in natural language. Do NOT pre-translate to SQL — the inner agent does that.
- `source_id` (optional when one database is attached, required when more than one): the id or exact name of the connection to query.

## Output

A JSON object with `connectionId`, `connectionName`, `sql` (the SQL the inner agent actually executed), `rowCount`, `rows`, `truncated`, and `durationMs`. If the input can't be resolved to a single connection, returns `{error: "ambiguous_source" | "connection_not_found", available: [...]}`. If the inner agent fails, returns `{error: "<code>", message, durationMs}` — common codes: `read_only_violation`, `no_query_executed`, `connection_failed`, `timeout`, `internal_error`.

Use the returned rows to synthesize a natural-language answer for the user. Cite the values that actually appear in the rows; never invent numbers that are not there.

## Answer format after calling this tool

Reply with **prose only** — one optional short sentence framing the answer, then the facts (do **not** print two similar introductions back-to-back). For multi-row results, use **one** markdown pipe table (`| column |`) — put a **blank line** before the table header row so it parses reliably.

**Do NOT include the SQL query in your reply.** The application UI renders the executed SQL automatically from tool metadata as a separate, collapsible panel beneath your answer. Repeating the SQL in your text creates duplication and renders poorly.

**Do NOT paste raw tool output.** The user already receives row data through the application; your message must be the synthesized answer only.

Describe roles or counts in natural language—avoid quoting raw DB column names or pointing users at `'member'.'role'` unless they explicitly asked about schema.

- Do **not** paste the JSON array/object of `rows`, or any ```json fenced dump of query results.
- Do **not** narrate implementation details (how you joined tables, which columns you matched, or schema exploration steps). Go straight to the answer.

### Correct example

  There are 4 users in your database.

### Incorrect examples (do NOT do this)

- Pasting a ```sql fenced block with the query — the UI already shows it.
- Pasting a ```json fenced block (or raw `[{...}]`) with row payloads — use prose or a markdown table instead.
- Explaining "I joined table X with table Y on …" before the answer — omit that entirely.
- Wrapping any part of the reply in a code fence.
- Prefixing the answer with "I ran the query …" or other meta-commentary about tool use.
