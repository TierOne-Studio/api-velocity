export type SqlConnectionStatus = 'connecting' | 'ready' | 'error';

export type SqlSslConfig =
  | boolean
  | {
      rejectUnauthorized?: boolean;
      ca?: string;
    };

export type SqlConnection = {
  id: string;
  organizationId: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl: SqlSslConfig;
  schemaName: string;
  /**
   * H1b: per-connection table allowlist. null = sub-agent sees the entire
   * schema (current behavior); array = whitelist of table names. Each entry
   * is unqualified ("users") or schema-qualified ("analytics.orders").
   */
  allowedTables: string[] | null;
  status: SqlConnectionStatus;
  statusError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SqlConnectionWithSecret = SqlConnection & {
  passwordCiphertext: string;
  passwordIv: string;
  passwordTag: string;
};

export type CreateSqlConnectionInput = {
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: SqlSslConfig;
  schemaName?: string;
  /** H1b: optional table allowlist. null/omitted = no allowlist. */
  allowedTables?: string[] | null;
};

export type UpdateSqlConnectionInput = {
  name?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  ssl?: SqlSslConfig;
  schemaName?: string;
  /**
   * H1b: optional table allowlist update. Omit to leave unchanged; pass
   * `null` to clear the allowlist; pass an array to replace.
   */
  allowedTables?: string[] | null;
};

export type TestSqlConnectionInput = {
  connectionId?: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
  ssl?: SqlSslConfig;
};

export type SqlConnectionRow = {
  id: string;
  organization_id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password_ciphertext: string;
  password_iv: string;
  password_tag: string;
  ssl: SqlSslConfig;
  schema_name: string;
  /** H1b: persisted as JSONB; null = no allowlist (sub-agent sees all). */
  allowed_tables: string[] | null;
  status: SqlConnectionStatus;
  status_error: string | null;
  created_at: string;
  updated_at: string;
};
