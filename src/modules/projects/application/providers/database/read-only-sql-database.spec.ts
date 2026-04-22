import { jest } from '@jest/globals';

jest.unstable_mockModule('@langchain/classic/sql_db', () => {
  class SqlDatabase {
    appDataSource: unknown;
    constructor(appDataSource: unknown) {
      this.appDataSource = appDataSource;
    }
    static async fromDataSourceParams(params: { appDataSource: unknown }) {
      return new SqlDatabase(params.appDataSource);
    }
    async run(_command: string, _fetch?: 'all' | 'one'): Promise<string> {
      return 'unused';
    }
  }
  return { SqlDatabase };
});

const { ReadOnlySqlDatabase } = await import('./read-only-sql-database');
const { ReadOnlyViolation } = await import('./types');
import type { SqlLimits } from './types';

const limits: SqlLimits = {
  statementTimeoutMs: 5000,
  idleTimeoutMs: 5000,
  connectTimeoutMs: 3000,
  maxRows: 100,
  maxBytes: 64_000,
  maxFieldBytes: 4000,
  maxSqlLength: 8192,
  poolMax: 2,
};

type QueryLog = string[];

function buildFakeDataSource(): { ds: unknown; log: QueryLog } {
  const log: QueryLog = [];
  const ds = {
    transaction: async <T>(fn: (tx: { query: (q: string) => Promise<unknown> }) => Promise<T>) => {
      const tx = {
        query: async (sql: string) => {
          log.push(sql);
          if (/SELECT/i.test(sql)) return [{ id: 1 }, { id: 2 }];
          return undefined;
        },
      };
      return fn(tx);
    },
  };
  return { ds, log };
}

describe('ReadOnlySqlDatabase', () => {
  it('rejects writes via validator before hitting the transaction', async () => {
    const { ds, log } = buildFakeDataSource();
    const db = await ReadOnlySqlDatabase.fromDataSource(ds as never, limits);
    await expect(db.run('DELETE FROM users')).rejects.toBeInstanceOf(
      ReadOnlyViolation,
    );
    expect(log).toHaveLength(0);
  });

  it('executes SET TRANSACTION READ ONLY and SET LOCAL timeouts before the query', async () => {
    const { ds, log } = buildFakeDataSource();
    const db = await ReadOnlySqlDatabase.fromDataSource(ds as never, limits);
    const out = await db.run('SELECT * FROM users LIMIT 10');
    expect(log[0]).toBe('SET TRANSACTION READ ONLY');
    expect(log[1]).toMatch(/statement_timeout\s*=\s*5000/);
    expect(log[2]).toMatch(/idle_in_transaction_session_timeout\s*=\s*5000/);
    expect(log[3]).toBe('SELECT * FROM users LIMIT 10');
    expect(JSON.parse(out)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('remembers lastExecutedSql after a successful run', async () => {
    const { ds } = buildFakeDataSource();
    const db = await ReadOnlySqlDatabase.fromDataSource(ds as never, limits);
    await db.run('SELECT 1');
    expect(db.lastExecutedSql).toBe('SELECT 1');
  });

  it('returns only the first row when fetch = "one"', async () => {
    const { ds } = buildFakeDataSource();
    const db = await ReadOnlySqlDatabase.fromDataSource(ds as never, limits);
    const out = await db.run('SELECT id FROM t', 'one');
    expect(JSON.parse(out)).toEqual({ id: 1 });
  });

  it('runRaw returns the raw rows array', async () => {
    const { ds } = buildFakeDataSource();
    const db = await ReadOnlySqlDatabase.fromDataSource(ds as never, limits);
    const rows = await db.runRaw('SELECT 1');
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('runRaw also enforces the validator', async () => {
    const { ds } = buildFakeDataSource();
    const db = await ReadOnlySqlDatabase.fromDataSource(ds as never, limits);
    await expect(db.runRaw('DROP TABLE users')).rejects.toBeInstanceOf(
      ReadOnlyViolation,
    );
  });
});
