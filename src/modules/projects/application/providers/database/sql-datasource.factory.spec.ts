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
      const factory = new SqlDataSourceFactory(limits);
      await expect(factory.get(conn(host))).rejects.toBeInstanceOf(
        UnsafeHostError,
      );
    },
  );
});

// TODO(2026-Q4): remove this breadcrumb once it's no longer surprising
// the host+port app-DB guard tests are gone.
//
// The host+port forbidden-app-DB guard (checkForbiddenAppDatabase /
// assertNotAppDatabase) was removed in ADR-010. The agent path now relies
// on the SQL validator's instance-metadata deny-list, the SET TRANSACTION
// READ ONLY chokepoint, and operator-provisioned SELECT-only Postgres role
// grants. The SSRF tests above remain — they assert the other Layer-C-
// adjacent defense (`assertSafeAgentHost`) is still wired into `factory.get()`.

// ADR-010 added a structured dial-time audit log (`[agent.dial] connectionId=...
// host=... port=... database=...`) in `SqlDataSourceFactory.get()` after the
// SSRF guard passes. The log is the SRE-facing tripwire that replaces the
// removed host+port guard. Unit-testing it via `jest.spyOn` on the imported
// `assertSafeAgentHost` doesn't work under `node --experimental-vm-modules`
// (the namespace is frozen in ESM). The structural assertion is deferred to
// the testcontainer-based smoke test tracked in ADR-010 Follow-up #1.
