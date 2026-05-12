/**
 * Sanitizes errors raised inside the chat-to-SQL agent path before they
 * become visible to the outer chat agent (and ultimately the user).
 *
 * The inner agent's tools (SqlToolkit) surface raw Postgres errors verbatim
 * — `relation "secret_audit_log" does not exist`, `permission denied for
 * column ssn_hash`, etc. Those errors carry the very schema details we
 * built the per-source allowlist (H1) to protect; passing them through to
 * the outer LLM defeats the layer.
 *
 * This sanitizer:
 *   - Categorizes the error into one of the existing chat-to-SQL codes.
 *   - Returns a canonical short `message` for the LLM that never names a
 *     table, column, identifier, IP, host, port, or credential.
 *   - Returns `serverDetail` for server-side logging so operators still
 *     get to see what actually happened (with credentials scrubbed).
 */
import type { ChatToSqlError } from './types';

export type SanitizedAgentError = {
  code: ChatToSqlError;
  /** Canonical short message safe to forward to the outer LLM. */
  message: string;
  /** Verbose detail for server-side logging only; never returned to LLM. */
  serverDetail: string;
};

/**
 * Server-side detail: strip obvious credential patterns but otherwise
 * preserve enough context for operators to debug.
 */
function scrubCredentials(raw: string): string {
  return raw
    .replace(/password=[^\s&;,)'"]+/gi, 'password=***')
    .replace(
      /postgres(?:ql)?:\/\/[^@\s]*@[^/\s]+/gi,
      'postgres://***:***@***',
    );
}

const PATTERNS: Array<{
  match: RegExp;
  code: ChatToSqlError;
  message: string;
}> = [
  // Read-only violation always wins — distinct + actionable.
  {
    match: /read[\s-]?only|cannot execute (?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)/i,
    code: 'read_only_violation',
    message: 'The agent attempted a non-read-only operation.',
  },
  // Statement-level timeout.
  {
    match: /statement timeout|canceling statement due to/i,
    code: 'timeout',
    message: 'The query timed out.',
  },
  // Connect-time failures.
  {
    match: /ECONNREFUSED|connect ETIMEDOUT|connection refused|could not connect/i,
    code: 'connection_failed',
    message: 'The database refused the connection.',
  },
  {
    match: /ENOTFOUND|getaddrinfo|name or service not known|EAI_AGAIN/i,
    code: 'connection_failed',
    message: 'The database hostname could not be resolved.',
  },
  // Permission errors — DO NOT echo the identifier names back.
  {
    match: /permission denied|insufficient_privilege|role .* does not have/i,
    code: 'internal_error',
    message:
      'The agent does not have access to one of the tables or columns referenced by this question.',
  },
  // Missing relation/column — DO NOT echo the identifier names back.
  {
    match: /relation .* does not exist|undefined_table/i,
    code: 'internal_error',
    message:
      'A table referenced by the query does not exist on the connected database.',
  },
  {
    match: /column .* does not exist|undefined_column/i,
    code: 'internal_error',
    message:
      'A column referenced by the query does not exist on the connected database.',
  },
  // Syntax errors.
  {
    match: /syntax error|invalid input syntax/i,
    code: 'internal_error',
    message: 'The generated query had a syntax error.',
  },
];

export function sanitizeAgentError(err: unknown): SanitizedAgentError {
  const raw = err instanceof Error ? err.message : String(err);
  const serverDetail = scrubCredentials(raw).slice(0, 1000);

  for (const { match, code, message } of PATTERNS) {
    if (match.test(raw)) return { code, message, serverDetail };
  }
  return {
    code: 'internal_error',
    message: 'The SQL agent hit an internal error.',
    serverDetail,
  };
}
