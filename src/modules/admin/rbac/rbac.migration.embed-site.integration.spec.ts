// Integration spec for `rbac_025_add_embed_site_permissions` against a REAL
// ephemeral Postgres (testcontainers, NOT mocks). Mirrors the testcontainers
// convention from embed-sites.integration.spec.ts and the assertion shape of
// rbac.migration.vector-db-upload.integration.spec.ts. Self-contained: it seeds
// the minimal RBAC schema (permissions/roles/role_permissions/organization) and
// then executes the migration's SQL for real — no shared DB, no skip.
//
// Load-bearing claims proven here (architect-reviewer MED-5):
//   - per-org admin gains the full embed-site CRUD set (read/create/update/delete).
//   - per-org manager gains read/create/update but NOT delete (disposal admin-only).
//   - per-org member is read-only.
//   - custom role w/ organization:update inherits create+update but NOT delete
//     and NOT read; w/ organization:read inherits read only; with neither → none.
//   - global superadmin gains all four.
//   - idempotent: embed-site grants stable on re-run; exactly one catalog row each.
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { DatabaseService } from '../../../shared/infrastructure/database/database.module';
import { RbacMigrationService } from './rbac.migration';

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
    async hasMigrationRun(): Promise<boolean> {
      return false;
    },
    async recordMigration(): Promise<void> {},
  } as unknown as DatabaseService;
}

async function caps(
  pool: Pool,
  roleId: string,
): Promise<Array<{ resource: string; action: string }>> {
  const result = await pool.query(
    `SELECT p.resource, p.action
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1`,
    [roleId],
  );
  return result.rows as Array<{ resource: string; action: string }>;
}

function has(
  rows: Array<{ resource: string; action: string }>,
  action: string,
): boolean {
  return rows.some((r) => r.resource === 'embed-site' && r.action === action);
}

describe('RbacMigrationService.addEmbedSitePermissions — real Postgres', () => {
  jest.setTimeout(120_000);
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let service: RbacMigrationService;

  const orgId = 'org-embed-rbac';
  let adminRoleId: string;
  let managerRoleId: string;
  let memberRoleId: string;
  let superadminRoleId: string;

  async function createRole(
    name: string,
    organizationId: string | null,
  ): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO roles (id, name, display_name, description, is_default, organization_id)
       VALUES ($1, $2::text, $2::text, $2::text, false, $3)`,
      [id, name, organizationId],
    );
    return id;
  }

  async function grant(
    roleId: string,
    resource: string,
    action: string,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE resource = $2 AND action = $3
       ON CONFLICT DO NOTHING`,
      [roleId, resource, action],
    );
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    service = new RbacMigrationService(makeDb(pool));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    // Minimal RBAC schema (subset of createRbacTables) + organization stub.
    await pool.query(`CREATE TABLE organization (id TEXT PRIMARY KEY)`);
    await pool.query(`
      CREATE TABLE roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(50) NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        description TEXT,
        is_default BOOLEAN DEFAULT false,
        organization_id TEXT REFERENCES organization(id) ON DELETE CASCADE
      )`);
    await pool.query(`
      CREATE TABLE permissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        resource VARCHAR(50) NOT NULL,
        action VARCHAR(50) NOT NULL,
        description TEXT,
        UNIQUE(resource, action)
      )`);
    await pool.query(`
      CREATE TABLE role_permissions (
        role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
        permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      )`);

    // Baseline org permissions the inheritance passes key off.
    await pool.query(
      `INSERT INTO permissions (resource, action, description) VALUES
         ('organization','read','View organizations'),
         ('organization','update','Update organizations')`,
    );

    await pool.query(`INSERT INTO organization (id) VALUES ($1)`, [orgId]);
    superadminRoleId = await createRole('superadmin', null);
    adminRoleId = await createRole('admin', orgId);
    managerRoleId = await createRole('manager', orgId);
    memberRoleId = await createRole('member', orgId);
    // Make the default roles realistic so the sync keeps their org grants.
    await grant(adminRoleId, 'organization', 'update');
    await grant(managerRoleId, 'organization', 'update');
    await grant(memberRoleId, 'organization', 'read');

    await service.addEmbedSitePermissions();
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (container) await container.stop();
  });

  it('grants the full embed-site CRUD set to the per-org admin role', async () => {
    const rows = await caps(pool, adminRoleId);
    expect(has(rows, 'read')).toBe(true);
    expect(has(rows, 'create')).toBe(true);
    expect(has(rows, 'update')).toBe(true);
    expect(has(rows, 'delete')).toBe(true);
  });

  it('grants read/create/update to the per-org manager but NOT delete', async () => {
    const rows = await caps(pool, managerRoleId);
    expect(has(rows, 'read')).toBe(true);
    expect(has(rows, 'create')).toBe(true);
    expect(has(rows, 'update')).toBe(true);
    expect(has(rows, 'delete')).toBe(false);
  });

  it('grants only read to the per-org member', async () => {
    const rows = await caps(pool, memberRoleId);
    expect(has(rows, 'read')).toBe(true);
    expect(has(rows, 'create')).toBe(false);
    expect(has(rows, 'update')).toBe(false);
    expect(has(rows, 'delete')).toBe(false);
  });

  it('grants all four embed-site permissions to the global superadmin', async () => {
    const rows = await caps(pool, superadminRoleId);
    expect(has(rows, 'read')).toBe(true);
    expect(has(rows, 'create')).toBe(true);
    expect(has(rows, 'update')).toBe(true);
    expect(has(rows, 'delete')).toBe(true);
  });

  it('custom role with organization:update inherits create+update but NOT delete and NOT read', async () => {
    const roleId = await createRole(`custom-upd-${randomUUID()}`, orgId);
    await grant(roleId, 'organization', 'update');
    await service.addEmbedSitePermissions();

    const rows = await caps(pool, roleId);
    expect(has(rows, 'create')).toBe(true);
    expect(has(rows, 'update')).toBe(true);
    expect(has(rows, 'delete')).toBe(false);
    expect(has(rows, 'read')).toBe(false);
  });

  it('custom role with organization:read inherits read only', async () => {
    const roleId = await createRole(`custom-read-${randomUUID()}`, orgId);
    await grant(roleId, 'organization', 'read');
    await service.addEmbedSitePermissions();

    const rows = await caps(pool, roleId);
    expect(has(rows, 'read')).toBe(true);
    expect(has(rows, 'create')).toBe(false);
    expect(has(rows, 'update')).toBe(false);
    expect(has(rows, 'delete')).toBe(false);
  });

  it('custom role with no organization permissions gains no embed-site grants', async () => {
    const roleId = await createRole(`custom-none-${randomUUID()}`, orgId);
    await service.addEmbedSitePermissions();

    const rows = await caps(pool, roleId);
    expect(rows.filter((r) => r.resource === 'embed-site')).toHaveLength(0);
  });

  it('is idempotent: exactly one catalog row per action after repeated runs', async () => {
    await service.addEmbedSitePermissions();
    await service.addEmbedSitePermissions();

    const result = await pool.query(
      `SELECT action, count(*)::int AS n FROM permissions
       WHERE resource = 'embed-site' GROUP BY action`,
    );
    for (const row of result.rows as Array<{ action: string; n: number }>) {
      expect(row.n).toBe(1);
    }
    // And the admin grant set is unchanged (stable on re-run).
    const rows = await caps(pool, adminRoleId);
    expect(has(rows, 'delete')).toBe(true);
  });
});
