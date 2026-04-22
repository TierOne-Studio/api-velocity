import type { ValidatorVerdict } from './types';

const DENY_WORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'CREATE',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'COPY',
  'VACUUM',
  'ANALYZE',
  'CLUSTER',
  'REINDEX',
  'LISTEN',
  'NOTIFY',
  'CALL',
  'LOCK',
  'RESET',
  'PG_SLEEP',
  'PG_READ_SERVER_FILES',
  'PG_LS_DIR',
  'PG_STAT_FILE',
  'PG_TERMINATE_BACKEND',
  'PG_CANCEL_BACKEND',
];

const DENY_REGEX = new RegExp(`\\b(${DENY_WORDS.join('|')})\\b`, 'i');
const DO_REGEX = /\bDO\b/i;
const SET_REGEX = /\bSET\b(?!\s+LOCAL\b)/i;
const ALLOWED_START = /^(WITH|SELECT|SHOW|EXPLAIN)\b/i;
// CTE-write guard: WITH ... AS ( ... INSERT|UPDATE|DELETE ... )
const CTE_WRITE_REGEX =
  /\bWITH\b[\s\S]*?\bAS\b[\s\S]*?\b(INSERT|UPDATE|DELETE)\b/i;

export function stripComments(sql: string): string {
  // Remove /* ... */ block comments and -- line comments. Block comments
  // collapse to the empty string so tokens the user split across a comment
  // (e.g. `IN/*x*/SERT`) fuse back into their underlying keyword — otherwise
  // the denylist's word-boundary match could be bypassed even though Postgres
  // would still reject the statement at parse time. Line comments keep a
  // single space because they always terminate at a newline boundary and
  // never bridge two halves of the same token.
  let previous: string;
  let current = sql;
  // Loop to handle rare nested block-comment patterns (Postgres supports
  // `/* /* */ */`). Each pass strips the innermost non-overlapping match.
  do {
    previous = current;
    current = current.replace(/\/\*[\s\S]*?\*\//g, '');
  } while (current !== previous);
  return current.replace(/--[^\n]*/g, ' ');
}

export function validateReadOnlySql(
  sql: string,
  options: { maxSqlLength: number },
): ValidatorVerdict {
  if (typeof sql !== 'string') {
    return { ok: false, reason: 'sql must be a string' };
  }
  if (sql.length === 0) {
    return { ok: false, reason: 'empty sql' };
  }
  if (sql.length > options.maxSqlLength) {
    return {
      ok: false,
      reason: `sql exceeds max length (${options.maxSqlLength})`,
    };
  }

  const stripped = stripComments(sql).trim();
  if (stripped.length === 0) {
    return { ok: false, reason: 'empty sql after comment strip' };
  }

  // Exactly one statement (strip optional trailing semicolon).
  const oneStatement = stripped.replace(/;\s*$/, '');
  if (/;/.test(oneStatement)) {
    return { ok: false, reason: 'multiple statements are not allowed' };
  }

  if (DENY_REGEX.test(oneStatement)) {
    return { ok: false, reason: 'write or dangerous keyword detected' };
  }

  if (CTE_WRITE_REGEX.test(oneStatement)) {
    return { ok: false, reason: 'CTE containing a write is not allowed' };
  }

  if (DO_REGEX.test(oneStatement)) {
    return { ok: false, reason: 'DO blocks are not allowed' };
  }

  if (SET_REGEX.test(oneStatement)) {
    return { ok: false, reason: 'SET (other than SET LOCAL) is not allowed' };
  }

  if (!ALLOWED_START.test(oneStatement)) {
    return {
      ok: false,
      reason: 'only SELECT / WITH / SHOW / EXPLAIN are allowed',
    };
  }

  return { ok: true };
}
