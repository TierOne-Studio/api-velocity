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

  it('redacts numeric literals because debug SQL summaries may contain sensitive numeric identifiers', () => {
    expect(
      redactSqlLiterals(`SELECT * FROM events WHERE rating > 4 LIMIT 100`),
    ).toBe(`SELECT * FROM events WHERE rating > <redacted> LIMIT <redacted>`);
  });

  it.each([
    [`SELECT * FROM events WHERE delta = -42`, `SELECT * FROM events WHERE delta = <redacted>`],
    [
      `SELECT * FROM events WHERE score >= 98.6`,
      `SELECT * FROM events WHERE score >= <redacted>`,
    ],
    [
      `SELECT * FROM events WHERE ratio < 1.2e-3`,
      `SELECT * FROM events WHERE ratio < <redacted>`,
    ],
    [`SELECT col1 FROM table2 WHERE id = 7`, `SELECT col1 FROM table2 WHERE id = <redacted>`],
  ])('redacts numeric literal boundary shape %#', (input, expected) => {
    expect(redactSqlLiterals(input)).toBe(expected);
  });

  it('preserves keywords and column names', () => {
    expect(
      redactSqlLiterals(
        `SELECT id, email, created_at FROM users ORDER BY id LIMIT 10`,
      ),
    ).toBe(
      `SELECT id, email, created_at FROM users ORDER BY id LIMIT <redacted>`,
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

  // qa LOW-5: edge cases worth pinning to the contract
  it('SQL comments containing quote-shaped sequences trigger over-redact (acceptable per doc)', () => {
    // The redactor scans linearly and doesn't parse comments; a `--` line
    // comment containing an unmatched quote will cause the rest of the
    // statement to be redacted. Doc contract says "over-redact, never
    // under-redact" — this test pins that.
    const sql = `SELECT id FROM users -- it's a comment\n WHERE id > 0`;
    const out = redactSqlLiterals(sql);
    // The exact shape depends on the scanner's state, but the safety
    // invariant is: no part of the comment text after the unclosed `'`
    // leaks through.
    expect(out).toContain('<redacted>');
    expect(out).not.toContain("it's a comment");
  });

  it('round-trips UTF-8 characters in identifiers untouched', () => {
    // Double-quoted identifiers pass through verbatim, including UTF-8.
    expect(
      redactSqlLiterals(`SELECT "Naïve" FROM "Café"`),
    ).toBe(`SELECT "Naïve" FROM "Café"`);
  });

  it('redacts UTF-8 characters inside literals (emoji + accented chars)', () => {
    // String literals with UTF-8 should be fully redacted; the surrogate
    // pairs in emoji shouldn't confuse the scanner's position tracking.
    expect(
      redactSqlLiterals(`SELECT * FROM t WHERE name = 'François' OR icon = '🦀'`),
    ).toBe(`SELECT * FROM t WHERE name = '<redacted>' OR icon = '<redacted>'`);
  });

  it('handles a very long literal without throwing or running indefinitely', () => {
    const longValue = 'x'.repeat(100_000);
    const sql = `SELECT * FROM t WHERE blob = '${longValue}'`;
    const out = redactSqlLiterals(sql);
    expect(out).toBe(`SELECT * FROM t WHERE blob = '<redacted>'`);
    expect(out).not.toContain(longValue);
  });
});
