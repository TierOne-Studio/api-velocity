import { UnsafeHostError } from '../../../../../shared/security/host-validator';
import {
  SqlDataSourceFactory,
  checkForbiddenAppDatabase,
} from './sql-datasource.factory';
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
    schemaName: null as unknown as string,
    allowedTables: null,
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
      const factory = new SqlDataSourceFactory(limits, []);
      await expect(factory.get(conn(host))).rejects.toBeInstanceOf(
        UnsafeHostError,
      );
    },
  );
});

describe('checkForbiddenAppDatabase (S1+S2+S4)', () => {
  it('allows when the forbidden list is empty', () => {
    expect(
      checkForbiddenAppDatabase([], {
        host: 'public.example.com',
        port: 5432,
      }),
    ).toEqual({ result: 'allow' });
    expect(
      checkForbiddenAppDatabase(null, {
        host: 'public.example.com',
        port: 5432,
      }),
    ).toEqual({ result: 'allow' });
  });

  it('forbids when host+port match the app DB (S1: regardless of database name)', () => {
    const check = checkForbiddenAppDatabase(
      ['postgres://u:p@app-db.internal:5432/app'],
      { host: 'app-db.internal', port: 5432 },
    );
    expect(check.result).toBe('forbidden');
  });

  it('forbids a sibling database on the same physical instance (S1)', () => {
    // Was the gap: old impl required database-name match too. Sibling DBs
    // share the same physical Postgres, so dblink etc. cross trivially.
    const check = checkForbiddenAppDatabase(
      ['postgres://u:p@10.0.1.5:5432/app'],
      { host: '10.0.1.5', port: 5432 },
    );
    expect(check.result).toBe('forbidden');
  });

  it('allows when host differs', () => {
    const check = checkForbiddenAppDatabase(
      ['postgres://u:p@app-db.internal:5432/app'],
      { host: 'other-db.example.com', port: 5432 },
    );
    expect(check.result).toBe('allow');
  });

  it('allows when port differs', () => {
    const check = checkForbiddenAppDatabase(
      ['postgres://u:p@app-db.internal:5432/app'],
      { host: 'app-db.internal', port: 6543 },
    );
    expect(check.result).toBe('allow');
  });

  it('compares host case-insensitively', () => {
    const check = checkForbiddenAppDatabase(
      ['postgres://u:p@APP-DB.INTERNAL:5432/app'],
      { host: 'app-db.internal', port: 5432 },
    );
    expect(check.result).toBe('forbidden');
  });

  it('treats missing port in URL as 5432 (Postgres default)', () => {
    const check = checkForbiddenAppDatabase(
      ['postgres://u:p@app-db.internal/app'],
      { host: 'app-db.internal', port: 5432 },
    );
    expect(check.result).toBe('forbidden');
  });

  it('S2: fails closed when any forbidden URL is malformed', () => {
    const check = checkForbiddenAppDatabase(['not-a-url'], {
      host: 'public.example.com',
      port: 5432,
    });
    expect(check.result).toBe('invalid-forbidden-url');
  });

  it('S2: the factory refuses to dial when any forbidden URL is malformed', async () => {
    const factory = new SqlDataSourceFactory(limits, ['not-a-url']);
    await expect(factory.get(conn('public.example.com'))).rejects.toThrow(
      /malformed; cannot verify/,
    );
  });

  // S4 coverage
  it('S4: forbids when matching any URL in the list (primary)', () => {
    const check = checkForbiddenAppDatabase(
      [
        'postgres://u:p@primary.internal:5432/app',
        'postgres://u:p@replica.internal:5432/app',
      ],
      { host: 'primary.internal', port: 5432 },
    );
    expect(check.result).toBe('forbidden');
  });

  it('S4: forbids when matching any URL in the list (replica)', () => {
    const check = checkForbiddenAppDatabase(
      [
        'postgres://u:p@primary.internal:5432/app',
        'postgres://u:p@replica.internal:5432/app',
      ],
      { host: 'replica.internal', port: 5432 },
    );
    expect(check.result).toBe('forbidden');
  });

  it('S4: allows when matching no URL in the list', () => {
    const check = checkForbiddenAppDatabase(
      [
        'postgres://u:p@primary.internal:5432/app',
        'postgres://u:p@replica.internal:5432/app',
      ],
      { host: 'public-db.example.com', port: 5432 },
    );
    expect(check.result).toBe('allow');
  });

  it('S4: a single malformed entry poisons the whole list (fail-closed)', () => {
    const check = checkForbiddenAppDatabase(
      ['postgres://u:p@primary.internal:5432/app', 'bad-url-entry'],
      { host: 'public-db.example.com', port: 5432 },
    );
    expect(check.result).toBe('invalid-forbidden-url');
  });
});
