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
