// Integration spec: exercises the embed-site persistence adapter against a REAL
// ephemeral Postgres (testcontainers), NOT mocks. Mirrors the testcontainers
// convention from projects-vector-db.integration.spec.ts.
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { DatabaseService } from '../../shared/infrastructure/database/database.module';
import type { ProjectsMigrationService } from '../projects/projects.migration';
import { EmbedSitesMigrationService } from './embed-sites.migration';
import { EmbedSiteDatabaseRepository } from './infrastructure/persistence/repositories/embed-site.database-repository';

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
    // The integration test re-runs DDL directly, so migration tracking is a no-op.
    async hasMigrationRun(): Promise<boolean> {
      return false;
    },
    async recordMigration(): Promise<void> {},
  } as unknown as DatabaseService;
}

describe('EmbedSite persistence — real Postgres', () => {
  jest.setTimeout(120_000);
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let repo: EmbedSiteDatabaseRepository;

  async function seedEmbedSite(
    label: string,
    opts: { allowedOrigins?: string[]; enabled?: boolean } = {},
  ): Promise<{
    orgId: string;
    projectId: string;
    siteId: string;
    publicKey: string;
  }> {
    const orgId = `org-${label}`;
    const projectId = randomUUID();
    const siteId = randomUUID();
    const publicKey = `wgt_pub_${label}`;
    await pool.query(
      `INSERT INTO organization (id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [orgId],
    );
    await pool.query(
      `INSERT INTO project (id, organization_id) VALUES ($1, $2)`,
      [projectId, orgId],
    );
    await pool.query(
      `INSERT INTO embed_site
         (id, organization_id, project_id, name, public_key, allowed_origins, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        siteId,
        orgId,
        projectId,
        `Site ${label}`,
        publicKey,
        opts.allowedOrigins ?? ['https://customer.com'],
        opts.enabled ?? true,
      ],
    );
    return { orgId, projectId, siteId, publicKey };
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    const db = makeDb(pool);
    repo = new EmbedSiteDatabaseRepository(db);

    // FK target stubs for embed_site / embed_usage_counter.
    await pool.query(`CREATE TABLE organization (id TEXT PRIMARY KEY)`);
    await pool.query(
      `CREATE TABLE project (
         id UUID PRIMARY KEY,
         organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE
       )`,
    );

    const migration = new EmbedSitesMigrationService(db, {
      runTrackedMigrations: async () => {},
    } as unknown as ProjectsMigrationService);
    await migration.runTrackedMigrations();
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (container) await container.stop();
  });

  describe('findByPublicKey', () => {
    it('returns the embed site for a known public key', async () => {
      const seeded = await seedEmbedSite('find1');

      const site = await repo.findByPublicKey(seeded.publicKey);

      expect(site).not.toBeNull();
      expect(site).toMatchObject({
        id: seeded.siteId,
        organizationId: seeded.orgId,
        projectId: seeded.projectId,
        name: 'Site find1',
        publicKey: seeded.publicKey,
        allowedOrigins: ['https://customer.com'],
        enabled: true,
        theme: null,
      });
    });

    it('returns null for an unknown public key', async () => {
      const site = await repo.findByPublicKey('wgt_pub_does_not_exist');
      expect(site).toBeNull();
    });

    it('resolves each key to ONLY its own org/project (cross-tenant isolation)', async () => {
      const a = await seedEmbedSite('isoA');
      const b = await seedEmbedSite('isoB');

      const siteA = await repo.findByPublicKey(a.publicKey);
      const siteB = await repo.findByPublicKey(b.publicKey);

      expect(siteA?.organizationId).toBe(a.orgId);
      expect(siteA?.projectId).toBe(a.projectId);
      expect(siteB?.organizationId).toBe(b.orgId);
      expect(siteB?.projectId).toBe(b.projectId);
      // Key A never resolves org/project B and vice-versa.
      expect(siteA?.organizationId).not.toBe(b.orgId);
      expect(siteA?.projectId).not.toBe(b.projectId);
    });
  });

  describe('incrementMonthlyUsage', () => {
    async function seedOrg(label: string): Promise<string> {
      const orgId = `org-${label}`;
      await pool.query(
        `INSERT INTO organization (id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [orgId],
      );
      return orgId;
    }

    it('returns 1 on the first increment of a new monthly window', async () => {
      const orgId = await seedOrg('cap1');
      await expect(repo.incrementMonthlyUsage(orgId)).resolves.toBe(1);
    });

    it('increments monotonically and durably across repository instances', async () => {
      const orgId = await seedOrg('cap2');
      await repo.incrementMonthlyUsage(orgId); // 1
      await repo.incrementMonthlyUsage(orgId); // 2

      // A fresh adapter instance simulates a process restart; the counter is in
      // Postgres, so it survives and continues from where it left off.
      const freshRepo = new EmbedSiteDatabaseRepository(makeDb(pool));
      await expect(freshRepo.incrementMonthlyUsage(orgId)).resolves.toBe(3);
    });

    it('is race-free under a concurrent burst (no lost updates)', async () => {
      const orgId = await seedOrg('cap3');
      const burst = 50;

      const counts = await Promise.all(
        Array.from({ length: burst }, () =>
          repo.incrementMonthlyUsage(orgId),
        ),
      );

      // Atomic increment ⇒ each concurrent call returns a distinct value and the
      // final count equals the number of calls (a non-atomic impl would lose
      // updates and the max would be < burst).
      expect(Math.max(...counts)).toBe(burst);
      expect(new Set(counts).size).toBe(burst);
    });

    it('keeps separate counters per organization', async () => {
      const orgA = await seedOrg('cap4a');
      const orgB = await seedOrg('cap4b');
      await repo.incrementMonthlyUsage(orgA);
      await repo.incrementMonthlyUsage(orgA);
      await expect(repo.incrementMonthlyUsage(orgB)).resolves.toBe(1);
    });
  });
});
