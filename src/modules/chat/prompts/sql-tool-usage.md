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
