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
  // Filesystem access via privileged Postgres functions. PG_READ_SERVER_FILES
  // is the *role* name; pg_read_file / pg_read_binary_file are the actual
  // function calls an attacker would invoke (C2).
  'PG_READ_SERVER_FILES',
  'PG_READ_FILE',
  'PG_READ_BINARY_FILE',
  'PG_LS_DIR',
  'PG_STAT_FILE',
  'PG_TERMINATE_BACKEND',
  'PG_CANCEL_BACKEND',
  // Large-object filesystem I/O (server-side import/export to disk) (C2).
  'LO_IMPORT',
  'LO_EXPORT',
  // Outbound network calls from inside the DB — exfil + SSRF primitive (C2).
  'DBLINK',
  'DBLINK_EXEC',
  // Session-scoped configuration changes (security HIGH-1). Postgres'
  // `set_config('foo', 'bar', false)` with the third arg false changes
  // the setting for the WHOLE session. A relaxed `statement_timeout` set
  // here survives the SET LOCAL reset our chokepoint relies on and
  // applies to subsequent queries that share the pooled session.
  'SET_CONFIG',
  // Cooperative-lock contention DoS surface (security HIGH-2).
  // The SET TRANSACTION READ ONLY guard doesn't reject pure lock calls.
  'PG_ADVISORY_LOCK',
  'PG_ADVISORY_XACT_LOCK',
  'PG_ADVISORY_UNLOCK',
  'PG_ADVISORY_UNLOCK_ALL',
  // Schema size / metadata info leak — bypasses the allowed_tables H1
  // allowlist by revealing the existence + magnitude of denied tables.
  'PG_RELATION_SIZE',
  'PG_TOTAL_RELATION_SIZE',
  'PG_DATABASE_SIZE',
  'PG_TABLESPACE_SIZE',
  // Foreign-data-wrapper config leak — reveals FDW server hosts/ports.
  'POSTGRES_FDW_GET_CONNECTIONS',
  'POSTGRES_FDW_DISCONNECT',
  'POSTGRES_FDW_DISCONNECT_ALL',
  // WAL pollution — bypasses RO by writing logical-decoding messages.
  'PG_LOGICAL_EMIT_MESSAGE',
  // Defense-in-depth info-leak block — current_setting() reads any
  // session GUC including possibly app-set ones the LLM shouldn't see.
  'CURRENT_SETTING',
  // Security HIGH-3: App-instance metadata-leak vectors.
  // When the agent shares a Postgres INSTANCE with the application (Layer C
  // host+port guard slated for removal in a follow-up slice), these system
  // catalogs would leak role names, password hashes, live sessions, server
  // config, and auth-file contents. Block them at the validator so the
  // read-only transaction + role-grant defenses don't have to carry the full
  // load. Word-boundary regex (`\b`) prevents false positives on identifier
  // SUBSTRINGS (e.g. a column named `last_pg_user_id` does NOT match
  // `PG_USER` because `_` is a `\w` character).
  'PG_SHADOW',
  'PG_AUTHID',
  'PG_ROLES',
  'PG_USER',
  'PG_STAT_ACTIVITY',
  'PG_STAT_REPLICATION',
  'PG_SETTINGS',
  'PG_HBA_FILE_RULES',
  'PG_FILE_SETTINGS',
  // Replication topology + connection-info leaks. `pg_subscription.subconninfo`
  // can disclose connection-string credentials on older Postgres versions
  // (before per-row redaction was tightened).
  'PG_REPLICATION_SLOTS',
  'PG_SUBSCRIPTION',
  'PG_PUBLICATION',
  // Function-form bypasses for the catalog views above. `pg_stat_activity`
  // is itself a view over `pg_stat_get_activity()`; blocking the view but
  // not the function would leave a trivial bypass. `pg_show_all_settings()`
  // and `pg_show_all_file_settings()` are function forms of `pg_settings` /
  // `pg_file_settings`. Word-boundary match works for both `name` and
  // `name(` because `(` is a non-word char.
  'PG_STAT_GET_ACTIVITY',
  'PG_SHOW_ALL_SETTINGS',
  'PG_SHOW_ALL_FILE_SETTINGS',
];

/**
 * Parameter names that `SHOW` MUST NOT reveal — filesystem paths, TLS material
 * paths, Kerberos realm, replication conn-info, and password-encryption mode.
 * Exported so the spec can loop over the full list and lock the contract.
 */
export const SHOW_SENSITIVE_PARAMS = [
  'data_directory',
  'hba_file',
  'config_file',
  'ident_file',
  'external_pid_file',
  'krb_server_keyfile',
  'krb_realm',
  'unix_socket_directories',
  'ssl_cert_file',
  'ssl_key_file',
  'ssl_ca_file',
  'ssl_crl_file',
  'primary_conninfo',
  'password_encryption',
] as const;

const DENY_REGEX = new RegExp(`\\b(${DENY_WORDS.join('|')})\\b`, 'i');
const DO_REGEX = /\bDO\b/i;
const SET_REGEX = /\bSET\b(?!\s+LOCAL\b)/i;
const ALLOWED_START = /^(WITH|SELECT|SHOW|EXPLAIN)\b/i;
// SHOW of filesystem/auth-config server parameters leaks operator-private
// paths (data_directory, hba_file) and TLS material paths the chat agent
// must never expose. `SHOW` itself stays in ALLOWED_START because benign
// uses like `SHOW TIMEZONE`/`SHOW search_path` are part of the agent's
// repertoire (referenced from the agent's system prompt). `SHOW ALL` is
// always denied because it dumps every GUC including the sensitive ones —
// it would be the trivial bypass of an explicit-param denylist.
const SHOW_SENSITIVE_REGEX = new RegExp(
  `\\bSHOW\\s+(?:ALL|${SHOW_SENSITIVE_PARAMS.join('|')})\\b`,
  'i',
);
// CTE-write guard: WITH ... AS ( ... INSERT|UPDATE|DELETE ... )
const CTE_WRITE_REGEX =
  /\bWITH\b[\s\S]*?\bAS\b[\s\S]*?\b(INSERT|UPDATE|DELETE)\b/i;
// SELECT col INTO new_table FROM old_table — Postgres "CREATE TABLE AS"
// semantics (writes). No INSERT/CREATE keyword appears textually, so the
// word-list guard misses it; this explicit regex closes the C2 gap.
// Matches a SELECT followed by INTO followed by an identifier, terminated
// by FROM / WHERE / a delimiter — common Postgres SELECT-INTO shapes.
const SELECT_INTO_REGEX =
  /\bSELECT\b[\s\S]+?\bINTO\b\s+["A-Za-z_][\w."]*\s*(?:FROM|WHERE|GROUP|HAVING|ORDER|LIMIT|;|$)/i;

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

  if (SELECT_INTO_REGEX.test(oneStatement)) {
    return {
      ok: false,
      reason: 'SELECT INTO is not allowed (creates a table)',
    };
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

  if (SHOW_SENSITIVE_REGEX.test(oneStatement)) {
    return {
      ok: false,
      reason: 'SHOW of sensitive server parameter is not allowed',
    };
  }

  if (!ALLOWED_START.test(oneStatement)) {
    return {
      ok: false,
      reason: 'only SELECT / WITH / SHOW / EXPLAIN are allowed',
    };
  }

  return { ok: true };
}
