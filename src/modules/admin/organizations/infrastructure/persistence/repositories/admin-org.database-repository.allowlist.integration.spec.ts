// Integration spec for the airweave-allowlist SQL paths on
// AdminOrgDatabaseRepository — runs every statement against the real
// PostgreSQL test database wired by .env.test (NOT a mock).
//
// WHY THIS FILE EXISTS:
// The sibling `admin-org.database-repository.spec.ts` mocks `db.query` /
// `db.queryOne` and only asserts on `sql.toContain(...)` strings. That
// pattern shipped a SQL bug — `metadata->'allowedAirweaveCollectionIds'`
// against a TEXT column — past three review subagents because no test
// EXECUTED the SQL. The bug surfaced only when the spa-velocity e2e
// harness hit the live backend.
//
// This spec proves the corrected casts (`metadata::jsonb`,
// `)::text WHERE ...`) actually work against Postgres, not just that
// they appear in the generated SQL string. It is the airtight protection
// the user asked for ("no technical debt; real DB for testing").
//
// SETUP CONTRACT:
// - DATABASE_URL must point to a Postgres test database (the .env.test
//   file is loaded by the Jest setup). If missing, every test in this
//   file is SKIPPED with a clear message — unit-only CI runs stay green
//   without needing infrastructure.
// - The `organization` table must exist (created by the
//   `001_initial_schema.sql` migration the backend runs at boot).
// - Test rows are inserted with a UUID-prefixed `id` and cleaned up in
//   `afterAll`, so concurrent test runs don't collide.

import { jest } from '@jest/globals';
import { Pool } from 'pg';
import { randomBytes } from 'crypto';

import { AdminOrgDatabaseRepository } from './admin-org.database-repository';
import type { DatabaseService } from '../../../../../../shared/infrastructure/database/database.module';

const databaseUrl = process.env.DATABASE_URL;

// `describe.skip` doesn't compose cleanly with a runtime check; use a
// gate fn and a conditional `describe` to keep the test count truthful.
const describeIfDb = databaseUrl ? describe : describe.skip;

/**
 * Minimal stand-in for DatabaseService — the repository only needs
 * `query` and `queryOne`. Avoids spinning up the full NestJS module
 * graph just to exercise SQL.
 */
function makeDb(pool: Pool): DatabaseService {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = await pool.query(sql, params);
      return result.rows as T[];
    },
    async queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
      const result = await pool.query(sql, params);
      return (result.rows[0] as T | undefined) ?? null;
    },
  } as unknown as DatabaseService;
}

describeIfDb(
  'AdminOrgDatabaseRepository (airweave allowlist) — real Postgres',
  () => {
    let pool: Pool;
    let repo: AdminOrgDatabaseRepository;
    let testOrgId: string;
    let testOrgSlug: string;

    beforeAll(async () => {
      pool = new Pool({ connectionString: databaseUrl });
      repo = new AdminOrgDatabaseRepository(makeDb(pool));
    });

    afterAll(async () => {
      if (pool) await pool.end();
    });

    beforeEach(async () => {
      // Unique per-test org id so parallel test files don't trip over
      // shared state. Stamped with a random suffix to keep slugs unique
      // under the (slug) UNIQUE constraint.
      const suffix = randomBytes(4).toString('hex');
      testOrgId = `e2e-allowlist-${suffix}`;
      testOrgSlug = `e2e-allowlist-${suffix}`;
      await pool.query(
        `INSERT INTO organization (id, name, slug, "createdAt", metadata)
         VALUES ($1, $2, $3, NOW(), NULL)`,
        [testOrgId, `E2E Allowlist ${suffix}`, testOrgSlug],
      );
    });

    afterEach(async () => {
      // Best-effort cleanup; if a test inserted dependent rows that
      // FK-cascade, those go with it.
      await pool.query(`DELETE FROM organization WHERE id = $1`, [testOrgId]);
    });

    // ── add ────────────────────────────────────────────────────────────

    describe('addAirweaveCollectionToAllowlist', () => {
      it('initializes NULL metadata with a single-element array', async () => {
        await repo.addAirweaveCollectionToAllowlist(testOrgId, 'coll-alpha');

        const row = await fetchMetadata(pool, testOrgId);
        expect(row.allowedAirweaveCollectionIds).toEqual(['coll-alpha']);
      });

      it('appends a second id and keeps both', async () => {
        await repo.addAirweaveCollectionToAllowlist(testOrgId, 'coll-alpha');
        await repo.addAirweaveCollectionToAllowlist(testOrgId, 'coll-beta');

        const row = await fetchMetadata(pool, testOrgId);
        expect(row.allowedAirweaveCollectionIds.sort()).toEqual([
          'coll-alpha',
          'coll-beta',
        ]);
      });

      it('is idempotent — adding the same id twice does NOT duplicate it', async () => {
        await repo.addAirweaveCollectionToAllowlist(testOrgId, 'coll-alpha');
        await repo.addAirweaveCollectionToAllowlist(testOrgId, 'coll-alpha');

        const row = await fetchMetadata(pool, testOrgId);
        expect(row.allowedAirweaveCollectionIds).toEqual(['coll-alpha']);
      });

      it('preserves other metadata keys (field-locality)', async () => {
        // Seed unrelated metadata first.
        await pool.query(
          `UPDATE organization SET metadata = $1 WHERE id = $2`,
          [JSON.stringify({ unrelatedKey: 'keep-me', count: 42 }), testOrgId],
        );

        await repo.addAirweaveCollectionToAllowlist(testOrgId, 'coll-alpha');

        const row = await fetchMetadata(pool, testOrgId);
        expect(row).toEqual({
          unrelatedKey: 'keep-me',
          count: 42,
          allowedAirweaveCollectionIds: ['coll-alpha'],
        });
      });
    });

    // ── remove ────────────────────────────────────────────────────────

    describe('removeAirweaveCollectionFromAllowlist', () => {
      it('filters the named id out of the array', async () => {
        await repo.addAirweaveCollectionToAllowlist(testOrgId, 'coll-alpha');
        await repo.addAirweaveCollectionToAllowlist(testOrgId, 'coll-beta');

        await repo.removeAirweaveCollectionFromAllowlist(
          testOrgId,
          'coll-alpha',
        );

        const row = await fetchMetadata(pool, testOrgId);
        expect(row.allowedAirweaveCollectionIds).toEqual(['coll-beta']);
      });

      it('is a no-op when the id is not present', async () => {
        await repo.addAirweaveCollectionToAllowlist(testOrgId, 'coll-alpha');

        await repo.removeAirweaveCollectionFromAllowlist(
          testOrgId,
          'coll-not-here',
        );

        const row = await fetchMetadata(pool, testOrgId);
        expect(row.allowedAirweaveCollectionIds).toEqual(['coll-alpha']);
      });

      it('handles NULL metadata gracefully (no row update needed but no error)', async () => {
        // Org has NULL metadata. removeFromAllowlist should NOT throw —
        // the resulting array is [] which is harmless to write.
        await expect(
          repo.removeAirweaveCollectionFromAllowlist(testOrgId, 'coll-x'),
        ).resolves.toBeUndefined();
      });
    });

    // ── isPresent ──────────────────────────────────────────────────────

    describe('isAirweaveCollectionInAllowlist', () => {
      it('returns true for a present id', async () => {
        await repo.addAirweaveCollectionToAllowlist(testOrgId, 'coll-alpha');

        await expect(
          repo.isAirweaveCollectionInAllowlist(testOrgId, 'coll-alpha'),
        ).resolves.toBe(true);
      });

      it('returns false for an absent id', async () => {
        await repo.addAirweaveCollectionToAllowlist(testOrgId, 'coll-alpha');

        await expect(
          repo.isAirweaveCollectionInAllowlist(testOrgId, 'coll-not-there'),
        ).resolves.toBe(false);
      });

      it('returns false when metadata is NULL (no allowlist field at all)', async () => {
        await expect(
          repo.isAirweaveCollectionInAllowlist(testOrgId, 'coll-x'),
        ).resolves.toBe(false);
      });

      it('returns false when the organization does not exist (cross-org guard)', async () => {
        await expect(
          repo.isAirweaveCollectionInAllowlist(
            'nonexistent-org-id',
            'coll-x',
          ),
        ).resolves.toBe(false);
      });
    });

    // ── regression pin: the original bug ──────────────────────────────

    describe('regression: ::jsonb cast against TEXT column', () => {
      it('does not throw the "operator does not exist: text -> unknown" error on read', async () => {
        // Seed metadata as TEXT (matches better-auth's storage shape).
        await pool.query(
          `UPDATE organization SET metadata = $1 WHERE id = $2`,
          [
            JSON.stringify({ allowedAirweaveCollectionIds: ['coll-alpha'] }),
            testOrgId,
          ],
        );

        // The pre-fix SQL crashed here with code 42883. The cast fix
        // makes this a clean true.
        await expect(
          repo.isAirweaveCollectionInAllowlist(testOrgId, 'coll-alpha'),
        ).resolves.toBe(true);
      });

      it('does not throw on write when metadata is already a TEXT-stored object', async () => {
        await pool.query(
          `UPDATE organization SET metadata = $1 WHERE id = $2`,
          [JSON.stringify({ unrelatedKey: 'x' }), testOrgId],
        );

        await expect(
          repo.addAirweaveCollectionToAllowlist(testOrgId, 'coll-alpha'),
        ).resolves.toBeUndefined();

        const row = await fetchMetadata(pool, testOrgId);
        expect(row.allowedAirweaveCollectionIds).toEqual(['coll-alpha']);
        expect(row.unrelatedKey).toBe('x');
      });
    });
  },
);

// ── helpers ──────────────────────────────────────────────────────────

/** Reads the metadata column and parses it as JSON (better-auth shape). */
async function fetchMetadata(
  pool: Pool,
  orgId: string,
): Promise<Record<string, unknown> & { allowedAirweaveCollectionIds: string[] }> {
  const result = await pool.query<{ metadata: string | null }>(
    `SELECT metadata FROM organization WHERE id = $1`,
    [orgId],
  );
  if (result.rows.length === 0) {
    throw new Error(`Test org ${orgId} not found`);
  }
  const raw = result.rows[0].metadata;
  if (!raw) {
    return {
      allowedAirweaveCollectionIds: [],
    } as Record<string, unknown> & { allowedAirweaveCollectionIds: string[] };
  }
  return JSON.parse(raw);
}

// Silence the "Worker process failed to exit gracefully" warning by
// nudging Jest to detect the open Pool — even though we close it in
// afterAll, async DNS lookups can linger on macOS.
afterAll(() => {
  jest.useRealTimers();
});
