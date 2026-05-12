import { UnsafeHostError } from '../../../../../shared/security/host-validator';
import { SqlDataSourceFactory } from './sql-datasource.factory';
import type { ResolvedSqlConnection, SqlLimits } from './types';

const limits: SqlLimits = {
  statementTimeoutMs: 5000,
  idleTimeoutMs: 5000,
  connectTimeoutMs: 2000,
  maxRows: 100,
  maxBytes: 64_000,
  maxFieldBytes: 4_000,
  maxSqlLength: 5000,
  poolMax: 2,
};

function conn(host: string): ResolvedSqlConnection {
  return {
    id: 'c-1',
    name: 'test',
    host,
    port: 5432,
    database: 'db',
    username: 'u',
    password: 'p',
    ssl: false,
    schemaName: null,
  };
}

describe('SqlDataSourceFactory (SSRF guard)', () => {
  it.each([
    ['169.254.169.254'],
    ['127.0.0.1'],
    ['10.0.0.5'],
    ['192.168.1.1'],
    ['localhost'],
    ['[::1]'],
  ])(
    'refuses to build a DataSource for unsafe host %s',
    async (host) => {
      const factory = new SqlDataSourceFactory(limits, null);
      await expect(factory.get(conn(host))).rejects.toBeInstanceOf(
        UnsafeHostError,
      );
    },
  );
});
