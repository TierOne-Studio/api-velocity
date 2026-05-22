## SQL toolkit usage

You have four tools available via the LangChain SqlToolkit:

1. **`list_tables_sql_db`** — list every table in the connected schema. Call this first if you don't already know the schema.
2. **`info_sql_db`** — given one or more table names, return column names, types, and a short sample. Use this to discover column names before you reference them.
3. **`query_sql_db`** — execute a single SELECT. Returns rows as JSON. Use `LIMIT`.
4. **`query_checker_sql_db`** (if available) — a lint step. Optional; useful for ambiguous joins.

## Typical flow

1. `list_tables_sql_db` → note the tables that look relevant to the question.
2. `info_sql_db` on 1–3 tables → read the columns.
3. `query_sql_db` with a single SELECT that answers the question. Add `LIMIT 100` unless the question asks for an aggregate.

Do not call `list_tables_sql_db` more than once per turn. Do not re-describe a table you've already seen. Keep the tool loop tight.

Do not pre-validate SQL. Submit your best query directly to `query_sql_db`; if it returns an error, use the error message to repair on the next iteration. (`query_checker_sql_db` may not be available in this environment — rely on the execution-error signal instead.)

When a `## Schema (already loaded — DO NOT re-fetch)` section is present above, the entire connection schema has been provided in your system prompt. **Skip `list_tables_sql_db` and `info_sql_db` entirely.** Go straight to `query_sql_db` with your best SELECT. Only call the discovery tools if a table you need is genuinely missing from the provided schema.
