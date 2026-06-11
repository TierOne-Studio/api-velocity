// Integration spec for `rbac_021_add_sql_connection_permissions` against
// real PostgreSQL (NOT a mock). Proves the load-bearing claims of ADR-012:
//
//   Decision 3 — "post-migration capability ⊇ pre-migration capability for
//   every role at migration time. No role loses any ability."
//
// The sibling `rbac.migration.spec.ts` covers the SQL string SHAPES (the
// migration emits the right INSERTs for the right SELECTs) but does not
// execute the SQL. This file fills the gap qa-validator flagged: actual
// pre/post `role_permissions` capability sets are observed against a real
// Postgres, for the full matrix of role fixtures the ADR enumerates.
//
// Per the post-impl review, this was the third gap: shape-only assertions
// are how the `metadata::jsonb` cast bug shipped past three review subagents
// for ADR-011. We're not repeating that.
//
// SETUP CONTRACT:
// - DATABASE_URL must point to a Postgres test DB (.env.test loaded by Jest
//   setup). Missing → all tests SKIPPED (describe.skip). Unit-only CI stays
//   green without infrastructure.
// - `permissions`, `roles`, `role_permissions`, `organization` tables must
//   exist (created by the boot-time migrations).
// - Test fixtures use UUID-prefixed ids and clean up in afterEach.

import { jest } from '@jest/globals';
import { Pool, type PoolClient } from 'pg';
import { randomBytes } from 'crypto';

import { RbacMigrationService } from './rbac.migration';
import type { DatabaseService } from '../../../shared/infrastructure/database/database.module';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

// Shared Postgres advisory-lock key serializing ALL RBAC migration integration
// specs against the same DB (each migration's additive `CROSS JOIN` grant scans
// the `roles` table org-wide; a sibling spec's afterEach `DELETE FROM roles`
// racing the SELECT→INSERT window causes a foreign-key violation). The key MUST
// match the sibling specs (rbac.migration.vector-db-upload.integration.spec.ts).
const RBAC_INTEGRATION_LOCK_KEY = 7281240;

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
    async transaction<T>(
      cb: (
        query: <Q>(sql: string, params?: unknown[]) => Promise<Q[]>,
      ) => Promise<T>,
    ): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await cb(async <Q>(sql: string, params?: unknown[]) => {
          const r = await client.query(sql, params);
          return r.rows as Q[];
        });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async hasMigrationRun(): Promise<boolean> {
      return false;
    },
    async recordMigration(): Promise<void> {
      // no-op for direct invocation tests
    },
  } as unknown as DatabaseService;
}

async function fetchRolePermissionTuples(
  pool: Pool,
  roleId: string,
): Promise<Array<{ resource: string; action: string }>> {
  const result = await pool.query(
    `SELECT p.resource, p.action
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1
     ORDER BY p.resource, p.action`,
    [roleId],
  );
  return result.rows as Array<{ resource: string; action: string }>;
}

function containsPermission(
  caps: Array<{ resource: string; action: string }>,
  resource: string,
  action: string,
): boolean {
  return caps.some((c) => c.resource === resource && c.action === action);
}

async function permissionId(pool: Pool, resource: string, action: string) {
  const result = await pool.query(
    `SELECT id FROM permissions WHERE resource = $1 AND action = $2`,
    [resource, action],
  );
  return (result.rows[0] as { id: string } | undefined)?.id ?? null;
}

async function grant(
  pool: Pool,
  roleId: string,
  resource: string,
  action: string,
) {
  const pId = await permissionId(pool, resource, action);
  if (!pId) {
    throw new Error(
      `Cannot grant ${resource}:${action} — permission row missing (run earlier migrations)`,
    );
  }
  await pool.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [roleId, pId],
  );
}

describeIfDb(
  'RbacMigrationService.addSqlConnectionPermissions — real Postgres',
  () => {
    // The migration enumerates every organization + re-syncs every default
    // role per-org, so it can run for several seconds against a non-trivial
    // test DB. Default Jest timeout (5s) is too tight.
    jest.setTimeout(60_000);

    let pool: Pool;
    let lockClient: PoolClient;
    let service: RbacMigrationService;
    let testOrgId: string;
    const cleanupRoleIds: string[] = [];

    beforeAll(async () => {
      pool = new Pool({ connectionString: databaseUrl });
      // Dedicated connection holds the cross-spec advisory lock (advisory locks
      // are session-scoped, so lock + unlock must use the SAME client).
      lockClient = await pool.connect();
      service = new RbacMigrationService(makeDb(pool));
    });

    afterAll(async () => {
      if (lockClient) lockClient.release();
      if (pool) await pool.end();
    });

    beforeEach(async () => {
      // Serialize against sibling RBAC migration integration specs (see
      // RBAC_INTEGRATION_LOCK_KEY) — blocks until any concurrent spec's test
      // body has finished, preventing the cross-spec role-deletion FK race.
      await lockClient.query('SELECT pg_advisory_lock($1)', [
        RBAC_INTEGRATION_LOCK_KEY,
      ]);
      const suffix = randomBytes(4).toString('hex');
      testOrgId = `e2e-sqlconn-${suffix}`;
      await pool.query(
        `INSERT INTO organization (id, name, slug, "createdAt", metadata)
         VALUES ($1, $2, $3, NOW(), NULL)`,
        [testOrgId, `E2E SqlConn ${suffix}`, `e2e-sqlconn-${suffix}`],
      );
    });

    afterEach(async () => {
      // Delete custom roles created during this test
      for (const id of cleanupRoleIds.splice(0)) {
        await pool.query(`DELETE FROM roles WHERE id = $1`, [id]);
      }
      await pool.query(`DELETE FROM organization WHERE id = $1`, [testOrgId]);
      await lockClient.query('SELECT pg_advisory_unlock($1)', [
        RBAC_INTEGRATION_LOCK_KEY,
      ]);
    });

    async function createCustomRole(
      name: string,
      organizationId: string | null,
    ): Promise<string> {
      const result = await pool.query(
        `INSERT INTO roles (name, display_name, description, color, is_default, organization_id)
         VALUES ($1, $2, $3, 'gray', false, $4)
         RETURNING id`,
        [name, name, name, organizationId],
      );
      const id = (result.rows[0] as { id: string }).id;
      cleanupRoleIds.push(id);
      return id;
    }

    // ── ADR-012 Decision 3 capability-superset guarantee ─────────────────

    it('grants sql-connection:create|update|delete to a custom role with organization:update', async () => {
      const customRoleId = await createCustomRole(
        `custom-with-org-update-${randomBytes(3).toString('hex')}`,
        testOrgId,
      );
      await grant(pool, customRoleId, 'organization', 'update');

      const pre = await fetchRolePermissionTuples(pool, customRoleId);
      expect(containsPermission(pre, 'organization', 'update')).toBe(true);
      expect(containsPermission(pre, 'sql-connection', 'create')).toBe(false);

      await service.addSqlConnectionPermissions();

      const post = await fetchRolePermissionTuples(pool, customRoleId);
      // Capability superset: every pre-perm is still there.
      for (const cap of pre) {
        expect(containsPermission(post, cap.resource, cap.action)).toBe(true);
      }
      // New grants per ADR-012 Decision 3b inheritance:
      expect(containsPermission(post, 'sql-connection', 'create')).toBe(true);
      expect(containsPermission(post, 'sql-connection', 'update')).toBe(true);
      expect(containsPermission(post, 'sql-connection', 'delete')).toBe(true);
    });

    it('grants sql-connection:read (only) to a custom role with organization:read but NOT organization:update', async () => {
      const customRoleId = await createCustomRole(
        `custom-read-only-${randomBytes(3).toString('hex')}`,
        testOrgId,
      );
      await grant(pool, customRoleId, 'organization', 'read');

      await service.addSqlConnectionPermissions();

      const post = await fetchRolePermissionTuples(pool, customRoleId);
      expect(containsPermission(post, 'organization', 'read')).toBe(true);
      expect(containsPermission(post, 'sql-connection', 'read')).toBe(true);
      // Mutate grants must NOT leak in:
      expect(containsPermission(post, 'sql-connection', 'create')).toBe(false);
      expect(containsPermission(post, 'sql-connection', 'update')).toBe(false);
      expect(containsPermission(post, 'sql-connection', 'delete')).toBe(false);
    });

    it('grants NOTHING to a custom role with no organization:* permissions', async () => {
      const customRoleId = await createCustomRole(
        `custom-no-org-${randomBytes(3).toString('hex')}`,
        testOrgId,
      );
      // No grants at all.

      await service.addSqlConnectionPermissions();

      const post = await fetchRolePermissionTuples(pool, customRoleId);
      expect(post.filter((p) => p.resource === 'sql-connection').length).toBe(
        0,
      );
    });

    it('preserves user-edited extra permissions on a custom role (additive only — no DELETE for custom roles)', async () => {
      const customRoleId = await createCustomRole(
        `custom-with-extras-${randomBytes(3).toString('hex')}`,
        testOrgId,
      );
      await grant(pool, customRoleId, 'organization', 'update');
      // Extras that should survive the migration:
      await grant(pool, customRoleId, 'chat', 'read');
      await grant(pool, customRoleId, 'project', 'read');

      await service.addSqlConnectionPermissions();

      const post = await fetchRolePermissionTuples(pool, customRoleId);
      expect(containsPermission(post, 'chat', 'read')).toBe(true);
      expect(containsPermission(post, 'project', 'read')).toBe(true);
      expect(containsPermission(post, 'organization', 'update')).toBe(true);
      // And the new inheritance grants are also present:
      expect(containsPermission(post, 'sql-connection', 'create')).toBe(true);
    });

    // ── Idempotency on intentional re-run ────────────────────────────────

    it('is row-count idempotent on intentional re-run (ON CONFLICT DO NOTHING + syncRolePermissions convergence)', async () => {
      const customRoleId = await createCustomRole(
        `custom-idempotent-${randomBytes(3).toString('hex')}`,
        testOrgId,
      );
      await grant(pool, customRoleId, 'organization', 'update');

      await service.addSqlConnectionPermissions();
      const afterFirst = await fetchRolePermissionTuples(pool, customRoleId);

      await service.addSqlConnectionPermissions();
      const afterSecond = await fetchRolePermissionTuples(pool, customRoleId);

      // Cross-spec serialization is enforced by RBAC_INTEGRATION_LOCK_KEY;
      // scoping idempotency to sql-connection is additionally the correct
      // assertion — it proves THIS migration's own grants are stable on re-run
      // rather than coupling to the whole role row set.
      const sc = (caps: Array<{ resource: string; action: string }>) =>
        caps.filter((c) => c.resource === 'sql-connection');
      expect(sc(afterSecond)).toEqual(sc(afterFirst));
    });

    it('registers exactly 4 sql-connection permissions in the catalog (no duplicates after multiple runs)', async () => {
      await service.addSqlConnectionPermissions();
      await service.addSqlConnectionPermissions();
      await service.addSqlConnectionPermissions();

      const result = await pool.query(
        `SELECT resource, action FROM permissions
         WHERE resource = 'sql-connection'
         ORDER BY action`,
      );
      expect(result.rows).toEqual([
        { resource: 'sql-connection', action: 'create' },
        { resource: 'sql-connection', action: 'delete' },
        { resource: 'sql-connection', action: 'read' },
        { resource: 'sql-connection', action: 'update' },
      ]);
    });

    // ── Superadmin coverage ──────────────────────────────────────────────

    it('grants all sql-connection permissions to the global superadmin role (matches addAirweavePermissions pattern)', async () => {
      await service.addSqlConnectionPermissions();

      const superadminRow = await pool.query(
        `SELECT id FROM roles WHERE name = 'superadmin' AND organization_id IS NULL`,
      );
      // The boot-time RBAC seed MUST have created the superadmin role. A
      // missing row means the test DB bootstrap is incomplete — fail
      // explicitly so a future incomplete fixture surfaces as a real test
      // failure instead of a silent false-positive.
      if (superadminRow.rows.length === 0) {
        throw new Error(
          'superadmin seed missing — fix the test DB bootstrap (run earlier RBAC migrations first)',
        );
      }
      const superadminId = (superadminRow.rows[0] as { id: string }).id;
      const caps = await fetchRolePermissionTuples(pool, superadminId);
      for (const action of ['read', 'create', 'update', 'delete']) {
        expect(containsPermission(caps, 'sql-connection', action)).toBe(true);
      }
    });

    // Suppress noisy console.log during integration runs.
    beforeAll(() => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
    });
  },
);
