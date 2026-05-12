/**
 * Smoke test for the chat-to-SQL data plane against a real Postgres
 * container (H4).
 *
 * Why this exists:
 *   - The inner agent uses `createAgent` from `langchain` paired with
 *     `SqlToolkit` from `@langchain/classic`. That's a half-step migration
 *     across two packages; the unit specs mock both. A version bump on
 *     either package could silently break the introspection or query
 *     path against a real database.
 *   - The fix in C3 (versioned ciphertext) and H1 (table allowlist) both
 *     depend on the SqlDatabase / DataSource integration actually working
 *     end-to-end.
 *
 * What this test does NOT cover:
 *   - The OpenAI LLM round-trip. We don't want a real OpenAI call in
 *     every smoke run, and the LLM is not the layer at risk from a
 *     langchain version bump on its own (it's a separate package).
 *   - Tests live alongside the unit specs but are excluded from the
 *     default `npm test` run via `testPathIgnorePatterns` in
 *     package.json. Run via `npm run test:smoke` — requires Docker.
 */
import { jest } from '@jest/globals';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { ReadOnlySqlDatabase } from './read-only-sql-database';
import { ReadOnlyViolation, type SqlLimits } from './types';

const limits: SqlLimits = {
  statementTimeoutMs: 5000,
  idleTimeoutMs: 5000,
  connectTimeoutMs: 3000,
  maxRows: 100,
  maxBytes: 64_000,
  maxFieldBytes: 4_000,
  maxSqlLength: 8192,
  poolMax: 2,
};

describe('chat-to-SQL → real Postgres smoke (H4)', () => {
  jest.setTimeout(120_000);
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      type: 'postgres',
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      username: container.getUsername(),
      password: container.getPassword(),
      entities: [],
      synchronize: false,
      extra: { max: 2 },
    });
    await dataSource.initialize();
    await dataSource.query(`
      CREATE TABLE users (
        id INT PRIMARY KEY,
        email TEXT NOT NULL
      )
    `);
    await dataSource.query(`
      INSERT INTO users (id, email) VALUES
        (1, 'alice@example.test'),
        (2, 'bob@example.test'),
        (3, 'carol@example.test')
    `);
    await dataSource.query(`CREATE TABLE secret_audit (id INT, note TEXT)`);
    await dataSource.query(`INSERT INTO secret_audit (id, note) VALUES (99, 'do not surface')`);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    if (container) await container.stop();
  });

  it('ReadOnlySqlDatabase.run returns rows from a real SELECT', async () => {
    const db = await ReadOnlySqlDatabase.fromDataSource(dataSource, limits);
    const out = await db.run('SELECT id, email FROM users ORDER BY id');
    const rows = JSON.parse(out) as Array<{ id: number; email: string }>;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ id: 1, email: 'alice@example.test' });
  });

  it('SET TRANSACTION READ ONLY blocks writes at the DB level', async () => {
    const db = await ReadOnlySqlDatabase.fromDataSource(dataSource, limits);
    // A write that bypasses our validator (theoretically) would still be
    // rejected by Postgres because the run() wrapper sets the transaction
    // to read-only before executing the user-supplied SQL. We can't sneak
    // a write past run()'s validator, so prove the underlying invariant
    // directly:
    await expect(
      dataSource.transaction(async (tx) => {
        await tx.query('SET TRANSACTION READ ONLY');
        await tx.query(`INSERT INTO users (id, email) VALUES (4, 'x@x.test')`);
      }),
    ).rejects.toThrow(/read[- ]?only transaction/i);

    // And the validator still keeps writes out via run() too.
    await expect(
      db.run(`INSERT INTO users (id, email) VALUES (5, 'y@x.test')`),
    ).rejects.toBeInstanceOf(ReadOnlyViolation);
  });

  it('statement_timeout enforces the per-query bound', async () => {
    const tight: SqlLimits = { ...limits, statementTimeoutMs: 50 };
    const db = await ReadOnlySqlDatabase.fromDataSource(dataSource, tight);
    // pg_sleep itself is in the deny list, so we can't use it through run();
    // instead drive a long-running aggregate against a recursive CTE.
    await expect(
      db.run(`
        WITH RECURSIVE counter(n) AS (
          SELECT 1
          UNION ALL
          SELECT n + 1 FROM counter WHERE n < 10000000
        )
        SELECT COUNT(*) FROM counter
      `),
    ).rejects.toThrow(/statement timeout|canceling statement/i);
  });

  it('includesTables scopes what the underlying SqlDatabase sees (H1c)', async () => {
    // Confirm SqlDatabase.fromDataSourceParams honors includesTables on a
    // real Postgres — when we restrict to ['users'], secret_audit must
    // not appear in the introspected schema.
    const restricted = await ReadOnlySqlDatabase.fromDataSource(
      dataSource,
      limits,
      { includesTables: ['users'] },
    );
    // The SqlDatabase exposes a tableInfo / getTableInfo API. Call it
    // through the public surface available on the prototype.
    // (We don't import @langchain/classic types here — go through the
    // instance's getTableInfo() which @langchain/classic provides.)
    const intro = (restricted as unknown as {
      getTableInfo: (tables?: string[]) => Promise<string>;
    }).getTableInfo();
    const text = await intro;
    expect(text).toMatch(/users/i);
    expect(text).not.toMatch(/secret_audit/i);
  });
});
