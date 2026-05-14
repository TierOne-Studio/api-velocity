import { scrubCredentials } from './credential-scrubber';

describe('scrubCredentials (security MED-9 SSoT)', () => {
  it('strips libpq-style password= flag', () => {
    expect(
      scrubCredentials('connect failed: password=hunter2 host=db.internal'),
    ).toBe('connect failed: password=*** host=db.internal');
  });

  it('strips postgres:// URL form (user, password, host:port together)', () => {
    // The `[^/\s]+` host segment greedily consumes `host:port` since `:`
    // isn't a path-or-whitespace delimiter — that's the desired behavior;
    // operator should not see the internal port either.
    const out = scrubCredentials(
      'Connection failed for postgres://app_admin:Sup3r$ecret@app-db.internal:5432/app',
    );
    expect(out).not.toContain('app_admin');
    expect(out).not.toContain('Sup3r$ecret');
    expect(out).not.toContain('app-db.internal');
    expect(out).not.toContain('5432');
    expect(out).toContain('postgres://***:***@***/app');
  });

  it('strips postgresql:// URL form (case insensitive)', () => {
    expect(
      scrubCredentials("POSTGRESQL://user:p@host/db"),
    ).toBe('postgres://***:***@***/db');
  });

  it('handles multiple credential patterns in one error', () => {
    const raw =
      "primary failed for postgres://a:b@h1/db, replica password=x123 host=h2";
    const out = scrubCredentials(raw);
    expect(out).not.toContain('a:b');
    expect(out).not.toContain('h1');
    expect(out).not.toContain('x123');
  });

  it('passes through strings with no credential patterns', () => {
    const benign = 'connection refused at host 10.0.0.5';
    expect(scrubCredentials(benign)).toBe(benign);
  });

  it('does not over-redact: empty input passes through', () => {
    expect(scrubCredentials('')).toBe('');
  });
});
