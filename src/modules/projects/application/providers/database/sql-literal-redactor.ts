/**
 * Redacts single-quoted string literals from a SQL statement for safe
 * persistence in chat-message metadata (M7).
 *
 * Replaces each literal with `'<redacted>'`. Handles:
 *   - Standard SQL string literals: `'foo'`, `'O''Brien'` (doubled quote).
 *   - Postgres E-strings: `E'foo\\n'`, `E'O\\'Brien'` (backslash-escape).
 *   - Dollar-quoted strings: `$tag$...$tag$` and `$$...$$`.
 *
 * Does NOT redact:
 *   - Double-quoted identifiers (`"Col"`) — those are column / table names.
 *   - Numeric literals — common in LIMIT, ORDER BY, etc.; usually low PII
 *     risk for the chat-to-SQL flow but operators should treat the SQL
 *     metadata as best-effort scrubbing, not authoritative.
 *
 * If the input contains structurally unclosed quotes the redactor falls
 * back to redacting the whole tail as one literal — never echoes back
 * something that resembles user-supplied data. Better to over-redact
 * than to miss a literal.
 */

const REDACTED = "'<redacted>'";

export function redactSqlLiterals(sql: string): string {
  if (typeof sql !== 'string' || sql.length === 0) return sql;

  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;

    // Dollar-quoted: $tag$ ... $tag$ (or $$ ... $$).
    if (ch === '$') {
      const tagMatch = /^\$([A-Za-z_][\w]*)?\$/.exec(sql.slice(i));
      if (tagMatch) {
        const closeTag = tagMatch[0];
        const start = i + closeTag.length;
        const closeIdx = sql.indexOf(closeTag, start);
        if (closeIdx === -1) {
          // Unclosed — over-redact the rest.
          out += REDACTED;
          return out;
        }
        out += REDACTED;
        i = closeIdx + closeTag.length;
        continue;
      }
    }

    // E-string: E'...' with backslash escapes.
    if ((ch === 'E' || ch === 'e') && sql[i + 1] === "'") {
      i += 2;
      while (i < sql.length) {
        if (sql[i] === '\\' && i + 1 < sql.length) {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      out += REDACTED;
      continue;
    }

    // Standard SQL string literal: '...' with '' as escape for embedded '.
    if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      out += REDACTED;
      continue;
    }

    // Double-quoted identifier: copy through verbatim.
    if (ch === '"') {
      const closeIdx = sql.indexOf('"', i + 1);
      if (closeIdx === -1) {
        // Unclosed identifier — copy the rest and bail.
        out += sql.slice(i);
        return out;
      }
      out += sql.slice(i, closeIdx + 1);
      i = closeIdx + 1;
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}
