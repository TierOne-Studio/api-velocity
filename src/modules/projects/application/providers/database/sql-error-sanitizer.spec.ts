import { sanitizeAgentError } from './sql-error-sanitizer';

describe('sanitizeAgentError', () => {
  it('categorizes "connection refused" as connection_failed', () => {
    const out = sanitizeAgentError(
      new Error('connect ECONNREFUSED 10.0.1.5:5432'),
    );
    expect(out.code).toBe('connection_failed');
    expect(out.message).toBe('The database refused the connection.');
    // No IP / port should leak into the LLM-bound message.
    expect(out.message).not.toContain('10.0.1.5');
  });

  it('categorizes statement_timeout as timeout', () => {
    const out = sanitizeAgentError(
      new Error('canceling statement due to statement timeout'),
    );
    expect(out.code).toBe('timeout');
    expect(out.message).toBe('The query timed out.');
  });

  it('categorizes read-only violation as read_only_violation', () => {
    const out = sanitizeAgentError(
      new Error('cannot execute UPDATE in a read-only transaction'),
    );
    expect(out.code).toBe('read_only_violation');
    expect(out.message).toBe('The agent attempted a non-read-only operation.');
  });

  it('redacts table/column identifiers from permission-denied errors (H5)', () => {
    const out = sanitizeAgentError(
      new Error(
        'permission denied for table secret_audit_log (column ssn_hash)',
      ),
    );
    expect(out.code).toBe('internal_error');
    expect(out.message).not.toContain('secret_audit_log');
    expect(out.message).not.toContain('ssn_hash');
    expect(out.message).toMatch(/agent does not have access/i);
  });

  it('redacts table names from "relation does not exist" errors (H5)', () => {
    const out = sanitizeAgentError(
      new Error('relation "secret_audit_log" does not exist'),
    );
    expect(out.code).toBe('internal_error');
    expect(out.message).not.toContain('secret_audit_log');
  });

  it('redacts column names from "column does not exist" errors (H5)', () => {
    const out = sanitizeAgentError(
      new Error('column "ssn_hash" does not exist'),
    );
    expect(out.code).toBe('internal_error');
    expect(out.message).not.toContain('ssn_hash');
  });

  it('redacts the connection string component if it slips through', () => {
    const out = sanitizeAgentError(
      new Error("connection to 'postgres://admin:secret@app-db.internal:5432/app' failed"),
    );
    expect(out.message).not.toContain('admin');
    expect(out.message).not.toContain('secret');
    expect(out.message).not.toContain('app-db.internal');
  });

  it('always exposes a serverDetail for server-side logging', () => {
    const out = sanitizeAgentError(
      new Error('relation "secret_audit_log" does not exist'),
    );
    expect(out.serverDetail).toContain('secret_audit_log'); // operator visibility
    expect(out.serverDetail).not.toMatch(/password=[^\s]+/i); // but no creds
  });

  it('falls back to internal_error for unknown shapes', () => {
    const out = sanitizeAgentError(new Error('something unexpected'));
    expect(out.code).toBe('internal_error');
    expect(out.message).toMatch(/internal error/i);
  });

  it('handles non-Error inputs (string / unknown)', () => {
    const out = sanitizeAgentError('plain string error');
    expect(out.code).toBe('internal_error');
  });

  it('redacts password=... in serverDetail too', () => {
    const out = sanitizeAgentError(
      new Error('auth failed with password=hunter2'),
    );
    expect(out.serverDetail).not.toContain('hunter2');
  });

  // qa LOW-4: first-match-wins ordering is load-bearing. The pattern table
  // has `permission denied` BEFORE `relation .* does not exist`. A
  // pathological error message that matches both should resolve to the
  // permission-denied category (and its canonical message that doesn't
  // echo identifiers). This pins the ordering contract so a future
  // refactor that reorders the PATTERNS array fails noisily.
  it('first-match-wins ordering: permission-denied beats relation-does-not-exist on ambiguous input', () => {
    const out = sanitizeAgentError(
      new Error(
        'permission denied for relation "secret_audit_log" does not exist',
      ),
    );
    expect(out.code).toBe('internal_error');
    // Permission-denied message wins (not the missing-table message).
    expect(out.message).toMatch(/agent does not have access/i);
    expect(out.message).not.toMatch(/does not exist/i);
    // Identifier still doesn't leak to the LLM-bound message.
    expect(out.message).not.toContain('secret_audit_log');
  });
});
