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
 *
 * If the input contains structurally unclosed quotes the redactor falls
 * back to redacting the whole tail as one literal — never echoes back
 * something that resembles user-supplied data. Better to over-redact
 * than to miss a literal.
 */

const REDACTED = "'<redacted>'";
const REDACTED_NUMERIC = '<redacted>';

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

    if (isNumericLiteralStart(sql, i)) {
      const numeric = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(sql.slice(i));
      if (numeric) {
        out += REDACTED_NUMERIC;
        i += numeric[0].length;
        continue;
      }
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

function isNumericLiteralStart(sql: string, index: number): boolean {
  const current = sql[index];
  const next = sql[index + 1];
  if (!/\d|-/.test(current ?? '')) return false;
  if (current === '-' && !/\d/.test(next ?? '')) return false;

  const previous = sql[index - 1];
  if (previous && /[A-Za-z0-9_$]/.test(previous)) return false;

  const candidate = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(sql.slice(index))?.[0];
  if (!candidate) return false;

  const following = sql[index + candidate.length];
  return !following || !/[A-Za-z0-9_$]/.test(following);
}
