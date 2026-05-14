/**
 * Strips credential-shaped patterns from error messages and other strings
 * that flow to logs / clients (security MED-9).
 *
 * The chat-to-SQL path has two converging consumers:
 *   - sql-error-sanitizer.ts: scrubs error messages BEFORE they reach the
 *     outer LLM or NestJS Logger.
 *   - sql-connection-tester.ts: scrubs error messages BEFORE they land in
 *     `status_error` on the sql_connections row (visible in the SPA admin
 *     UI to operators of the same org).
 *
 * Both should apply the same scrubbing so a credential pattern stripped
 * from one path can't sneak through the other. This module is the SSoT.
 *
 * Patterns covered:
 *   - `password=...` (libpq-style connection string flag).
 *   - `postgres://user:pass@host/db` URL form (full user-info segment
 *     redacted, host included to avoid leaking app-internal hostnames).
 *   - libpq URI form with whitespace separators (`user=foo password=...`).
 */

export function scrubCredentials(raw: string): string {
  return raw
    .replace(/password=[^\s&;,)'"]+/gi, 'password=***')
    .replace(
      /postgres(?:ql)?:\/\/[^@\s]*@[^/\s]+/gi,
      'postgres://***:***@***',
    );
}
