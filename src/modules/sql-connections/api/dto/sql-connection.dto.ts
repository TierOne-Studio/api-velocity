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
  status: SqlConnectionStatus;
  status_error: string | null;
  created_at: string;
  updated_at: string;
};
