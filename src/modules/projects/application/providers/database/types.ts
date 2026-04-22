export type SqlLimits = {
  statementTimeoutMs: number;
  idleTimeoutMs: number;
  connectTimeoutMs: number;
  maxRows: number;
  maxBytes: number;
  maxFieldBytes: number;
  maxSqlLength: number;
  poolMax: number;
};

export type ResolvedSqlConnection = {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: unknown;
  schemaName: string;
};

export type ValidatorVerdict =
  | { ok: true }
  | { ok: false; reason: string };

export type ShapedQueryResult = {
  rowCount: number;
  rows: unknown[];
  truncated: boolean;
  note?: string;
};

export class ReadOnlyViolation extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ReadOnlyViolation';
  }
}
