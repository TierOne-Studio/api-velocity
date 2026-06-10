// Integration spec for `rbac_024_add_vector_db_upload_permission` against real
// PostgreSQL (NOT a mock). Fills the gap qa-validator flagged: the sibling
// `rbac.migration.spec.ts` covers the SQL string SHAPES but does not execute the
// SQL, and rbac_024 reuses the same error-prone `CROSS JOIN permissions … ON
// CONFLICT DO NOTHING` inheritance construct that the rbac_021 integration spec
// was created to guard. This file observes actual pre/post `role_permissions`
// capability sets against a real Postgres.
//
// Load-bearing claims proven here:
//   - admin + manager gain `vector-db:upload`; member stays read-only.
//   - rbac_023's revocation holds: re-syncing manager does NOT re-grant delete.
//   - custom-role inheritance: `organization:update` → upload; `organization:read`
//     alone → nothing; no org perms → nothing.
//   - idempotency: row-count stable on re-run; exactly one catalog row.
//   - superadmin gains upload.
//
// SETUP CONTRACT (mirrors rbac.migration.sql-connection.integration.spec.ts):
// - DATABASE_URL must point to a Postgres test DB (.env.test loaded by Jest
//   setup). Missing → all tests SKIPPED (describe.skip). Unit-only CI stays green.
// - `permissions`, `roles`, `role_permissions`, `organization` tables must exist
//   (created by the boot-time migrations). Fixtures clean up in afterEach.

import { jest } from '@jest/globals';
import { Pool, type PoolClient } from 'pg';
import { randomBytes } from 'crypto';

import { RbacMigrationService } from './rbac.migration';
import type { DatabaseService } from '../../../shared/infrastructure/database/database.module';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

// Shared Postgres advisory-lock key serializing ALL RBAC migration integration
// specs against the same DB. Each migration's additive `CROSS JOIN` grant scans
// the `roles` table org-wide; without serialization a sibling spec's afterEach
// `DELETE FROM roles` can land between this migration's SELECT and INSERT →
// foreign-key violation. The key MUST match the sibling specs
// (rbac.migration.sql-connection.integration.spec.ts).
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
  'RbacMigrationService.addVectorDbUploadPermission — real Postgres',
  () => {
    // The migration enumerates every organization + re-syncs every default role
    // per-org, so it can run for several seconds. Default Jest timeout is tight.
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
      jest.spyOn(console, 'log').mockImplementation(() => {});
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
      testOrgId = `e2e-vdbupload-${suffix}`;
      await pool.query(
        `INSERT INTO organization (id, name, slug, "createdAt", metadata)
         VALUES ($1, $2, $3, NOW(), NULL)`,
        [testOrgId, `E2E VdbUpload ${suffix}`, `e2e-vdbupload-${suffix}`],
      );
    });

    afterEach(async () => {
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

    // ── Default-role policy matrix (the core of the change) ───────────────

    it('grants vector-db:upload to per-org admin + manager, leaves member read-only, and does NOT re-grant manager delete', async () => {
      const adminId = await createCustomRole('admin', testOrgId);
      const managerId = await createCustomRole('manager', testOrgId);
      const memberId = await createCustomRole('member', testOrgId);

      await service.addVectorDbUploadPermission();

      const adminCaps = await fetchRolePermissionTuples(pool, adminId);
      const managerCaps = await fetchRolePermissionTuples(pool, managerId);
      const memberCaps = await fetchRolePermissionTuples(pool, memberId);

      expect(containsPermission(adminCaps, 'vector-db', 'upload')).toBe(true);
      expect(containsPermission(managerCaps, 'vector-db', 'upload')).toBe(true);
      // Member is read-only.
      expect(containsPermission(memberCaps, 'vector-db', 'upload')).toBe(false);
      // Cross-step seam: re-syncing manager from the constant must NOT undo
      // rbac_023's delete revocation.
      expect(containsPermission(managerCaps, 'vector-db', 'delete')).toBe(
        false,
      );
      // Sanity: manager keeps the rest of the vector-db CRUD set.
      expect(containsPermission(managerCaps, 'vector-db', 'read')).toBe(true);
      expect(containsPermission(managerCaps, 'vector-db', 'create')).toBe(true);
      expect(containsPermission(managerCaps, 'vector-db', 'update')).toBe(true);
    });

    // ── Custom-role inheritance (organization:update) ─────────────────────

    it('grants vector-db:upload to a custom role holding organization:update (capability superset preserved)', async () => {
      const customRoleId = await createCustomRole(
        `custom-upd-${randomBytes(3).toString('hex')}`,
        testOrgId,
      );
      await grant(pool, customRoleId, 'organization', 'update');

      const pre = await fetchRolePermissionTuples(pool, customRoleId);
      expect(containsPermission(pre, 'vector-db', 'upload')).toBe(false);

      await service.addVectorDbUploadPermission();

      const post = await fetchRolePermissionTuples(pool, customRoleId);
      for (const cap of pre) {
        expect(containsPermission(post, cap.resource, cap.action)).toBe(true);
      }
      expect(containsPermission(post, 'vector-db', 'upload')).toBe(true);
    });

    it('does NOT grant vector-db:upload to a custom role with only organization:read', async () => {
      const customRoleId = await createCustomRole(
        `custom-read-${randomBytes(3).toString('hex')}`,
        testOrgId,
      );
      await grant(pool, customRoleId, 'organization', 'read');

      await service.addVectorDbUploadPermission();

      const post = await fetchRolePermissionTuples(pool, customRoleId);
      expect(containsPermission(post, 'organization', 'read')).toBe(true);
      expect(containsPermission(post, 'vector-db', 'upload')).toBe(false);
    });

    it('grants no vector-db:upload to a custom role with no organization:* permissions', async () => {
      const customRoleId = await createCustomRole(
        `custom-none-${randomBytes(3).toString('hex')}`,
        testOrgId,
      );

      await service.addVectorDbUploadPermission();

      const post = await fetchRolePermissionTuples(pool, customRoleId);
      expect(containsPermission(post, 'vector-db', 'upload')).toBe(false);
    });

    it('preserves user-edited extra permissions on a custom role (additive only)', async () => {
      const customRoleId = await createCustomRole(
        `custom-extras-${randomBytes(3).toString('hex')}`,
        testOrgId,
      );
      await grant(pool, customRoleId, 'organization', 'update');
      await grant(pool, customRoleId, 'chat', 'read');
      await grant(pool, customRoleId, 'project', 'read');

      await service.addVectorDbUploadPermission();

      const post = await fetchRolePermissionTuples(pool, customRoleId);
      expect(containsPermission(post, 'chat', 'read')).toBe(true);
      expect(containsPermission(post, 'project', 'read')).toBe(true);
      expect(containsPermission(post, 'organization', 'update')).toBe(true);
      expect(containsPermission(post, 'vector-db', 'upload')).toBe(true);
    });

    // ── Idempotency ──────────────────────────────────────────────────────

    it('is row-count idempotent on intentional re-run', async () => {
      const customRoleId = await createCustomRole(
        `custom-idem-${randomBytes(3).toString('hex')}`,
        testOrgId,
      );
      await grant(pool, customRoleId, 'organization', 'update');

      await service.addVectorDbUploadPermission();
      const afterFirst = await fetchRolePermissionTuples(pool, customRoleId);

      await service.addVectorDbUploadPermission();
      const afterSecond = await fetchRolePermissionTuples(pool, customRoleId);

      // Cross-spec serialization is enforced by RBAC_INTEGRATION_LOCK_KEY;
      // scoping idempotency to vector-db is additionally the correct assertion —
      // it proves THIS migration's own grants are stable on re-run rather than
      // coupling to the whole role row set.
      const vdb = (caps: Array<{ resource: string; action: string }>) =>
        caps.filter((c) => c.resource === 'vector-db');
      expect(vdb(afterSecond)).toEqual(vdb(afterFirst));
      expect(vdb(afterSecond)).toEqual([
        { resource: 'vector-db', action: 'upload' },
      ]);
    });

    it('registers exactly one vector-db:upload catalog row after multiple runs', async () => {
      await service.addVectorDbUploadPermission();
      await service.addVectorDbUploadPermission();
      await service.addVectorDbUploadPermission();

      const result = await pool.query(
        `SELECT count(*)::int AS n FROM permissions
         WHERE resource = 'vector-db' AND action = 'upload'`,
      );
      expect((result.rows[0] as { n: number }).n).toBe(1);
    });

    // ── Superadmin ────────────────────────────────────────────────────────

    it('grants vector-db:upload to the global superadmin role', async () => {
      await service.addVectorDbUploadPermission();

      const superadminRow = await pool.query(
        `SELECT id FROM roles WHERE name = 'superadmin' AND organization_id IS NULL`,
      );
      if (superadminRow.rows.length === 0) {
        throw new Error(
          'superadmin seed missing — fix the test DB bootstrap (run earlier RBAC migrations first)',
        );
      }
      const superadminId = (superadminRow.rows[0] as { id: string }).id;
      const caps = await fetchRolePermissionTuples(pool, superadminId);
      expect(containsPermission(caps, 'vector-db', 'upload')).toBe(true);
    });
  },
);
