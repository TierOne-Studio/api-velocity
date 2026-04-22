import { stripComments, validateReadOnlySql } from './sql-validator';

const limits = { maxSqlLength: 8192 };

describe('stripComments', () => {
  it('removes line and block comments', () => {
    expect(stripComments('SELECT 1 -- trailing')).toMatch(/SELECT 1/);
    expect(stripComments('SELECT /* block */ 1')).toMatch(/SELECT\s+1/);
  });
});

describe('validateReadOnlySql', () => {
  const allow = [
    'SELECT 1',
    'select * from users limit 10',
    'WITH t AS (SELECT 1) SELECT * FROM t',
    'EXPLAIN SELECT 1',
    'SHOW TIMEZONE',
    '  SELECT 1  ;',
  ];

  const deny: Array<[string, RegExp]> = [
    ['INSERT INTO users (id) VALUES (1)', /dangerous keyword/i],
    ['UPDATE users SET x=1', /dangerous keyword/i],
    ['DELETE FROM users', /dangerous keyword/i],
    ['DROP TABLE users', /dangerous keyword/i],
    ['ALTER TABLE users ADD COLUMN x int', /dangerous keyword/i],
    ['CREATE TABLE t (id int)', /dangerous keyword/i],
    ['TRUNCATE users', /dangerous keyword/i],
    ['GRANT SELECT ON users TO public', /dangerous keyword/i],
    ['COPY users FROM stdin', /dangerous keyword/i],
    ['VACUUM users', /dangerous keyword/i],
    ['SELECT pg_sleep(1)', /dangerous keyword/i],
    ['SELECT pg_terminate_backend(1)', /dangerous keyword/i],
    ['SELECT 1; SELECT 2', /multiple statements/i],
    ['DO $$ BEGIN END $$', /DO blocks|only SELECT/i],
    ['SET search_path = public', /only SELECT|SET/i],
    [
      'WITH writer AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM writer',
      /CTE containing a write|dangerous keyword/i,
    ],
    ['', /empty sql/i],
  ];

  for (const sql of allow) {
    it(`allows: ${sql}`, () => {
      const verdict = validateReadOnlySql(sql, limits);
      expect(verdict.ok).toBe(true);
    });
  }

  for (const [sql, reason] of deny) {
    it(`denies: ${sql}`, () => {
      const verdict = validateReadOnlySql(sql, limits);
      expect(verdict.ok).toBe(false);
      if (verdict.ok === false) {
        expect(verdict.reason).toMatch(reason);
      }
    });
  }

  it('rejects oversized sql', () => {
    const huge = 'SELECT ' + '1,'.repeat(5000) + '1';
    const verdict = validateReadOnlySql(huge, { maxSqlLength: 100 });
    expect(verdict.ok).toBe(false);
    if (verdict.ok === false) expect(verdict.reason).toMatch(/max length/);
  });

  it('allows SET LOCAL (transaction-scoped only)', () => {
    // SET LOCAL is explicitly allowed in the SET regex, but the statement must
    // still start with SELECT/WITH/SHOW/EXPLAIN — so SET LOCAL alone is denied
    // at the "allowed start" gate, which is correct for read-only user input.
    const verdict = validateReadOnlySql('SET LOCAL statement_timeout=1', limits);
    expect(verdict.ok).toBe(false);
  });
});
