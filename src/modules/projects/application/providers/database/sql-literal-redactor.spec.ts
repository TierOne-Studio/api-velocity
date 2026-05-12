import { redactSqlLiterals } from './sql-literal-redactor';

describe('redactSqlLiterals (M7)', () => {
  it('redacts a simple single-quoted literal', () => {
    expect(
      redactSqlLiterals(`SELECT id FROM users WHERE email = 'alice@x.test'`),
    ).toBe(`SELECT id FROM users WHERE email = '<redacted>'`);
  });

  it('redacts multiple literals independently', () => {
    expect(
      redactSqlLiterals(
        `SELECT * FROM events WHERE actor = 'alice' AND action = 'login'`,
      ),
    ).toBe(
      `SELECT * FROM events WHERE actor = '<redacted>' AND action = '<redacted>'`,
    );
  });

  it("handles a doubled-quote SQL escape (e.g. O''Brien) as part of the literal", () => {
    expect(
      redactSqlLiterals(`SELECT * FROM users WHERE name = 'O''Brien'`),
    ).toBe(`SELECT * FROM users WHERE name = '<redacted>'`);
  });

  it("preserves double-quoted identifiers (Postgres column / table names)", () => {
    expect(
      redactSqlLiterals(`SELECT "Name" FROM "User" WHERE "Email" = 'a@b.test'`),
    ).toBe(`SELECT "Name" FROM "User" WHERE "Email" = '<redacted>'`);
  });

  it('redacts a Postgres E-string with backslash escape', () => {
    expect(
      redactSqlLiterals(`SELECT * FROM t WHERE note = E'line1\\nline2'`),
    ).toBe(`SELECT * FROM t WHERE note = '<redacted>'`);
  });

  it('redacts a dollar-quoted literal (tagged)', () => {
    expect(
      redactSqlLiterals(`SELECT $tag$secret value$tag$ AS s`),
    ).toBe(`SELECT '<redacted>' AS s`);
  });

  it('redacts a dollar-quoted literal (untagged)', () => {
    expect(redactSqlLiterals(`SELECT $$plain$$ AS s`)).toBe(
      `SELECT '<redacted>' AS s`,
    );
  });

  it('preserves numeric literals (low PII risk; not in scope)', () => {
    expect(
      redactSqlLiterals(`SELECT * FROM events WHERE rating > 4 LIMIT 100`),
    ).toBe(`SELECT * FROM events WHERE rating > 4 LIMIT 100`);
  });

  it('preserves keywords and column names', () => {
    expect(
      redactSqlLiterals(
        `SELECT id, email, created_at FROM users ORDER BY id LIMIT 10`,
      ),
    ).toBe(
      `SELECT id, email, created_at FROM users ORDER BY id LIMIT 10`,
    );
  });

  it('handles empty / null-ish inputs', () => {
    expect(redactSqlLiterals('')).toBe('');
    expect(redactSqlLiterals(null as unknown as string)).toBe(null);
  });

  it('does not mangle a SQL with no literals', () => {
    const sql = `SELECT COUNT(*) FROM users`;
    expect(redactSqlLiterals(sql)).toBe(sql);
  });

  it('over-redacts (safer than under-redacts) when a quote is unclosed', () => {
    const out = redactSqlLiterals(`SELECT * FROM users WHERE x = 'unclosed`);
    expect(out).toContain('<redacted>');
    expect(out).not.toContain('unclosed');
  });

  it('handles a dollar-quoted unclosed tag by over-redacting the tail', () => {
    const out = redactSqlLiterals(`SELECT $tag$open value never closed`);
    expect(out).toContain('<redacted>');
    expect(out).not.toContain('open value');
  });
});
