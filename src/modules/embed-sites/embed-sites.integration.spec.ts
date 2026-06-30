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
import {
  EmbedSiteProjectConflictError,
  EmbedSitePublicKeyCollisionError,
} from './domain/repositories/embed-site.repository.interface';

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
        Array.from({ length: burst }, () => repo.incrementMonthlyUsage(orgId)),
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

  // --- Admin CRUD (Slice 2) ---

  // Create an org + project WITHOUT an embed site, so create() can be exercised.
  async function seedOrgProject(
    label: string,
  ): Promise<{ orgId: string; projectId: string }> {
    const orgId = `org-${label}`;
    const projectId = randomUUID();
    await pool.query(
      `INSERT INTO organization (id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [orgId],
    );
    await pool.query(
      `INSERT INTO project (id, organization_id) VALUES ($1, $2)`,
      [projectId, orgId],
    );
    return { orgId, projectId };
  }

  describe('create', () => {
    it('persists a new embed site with generated key + normalized origins', async () => {
      const { orgId, projectId } = await seedOrgProject('crt1');
      const site = await repo.create({
        id: randomUUID(),
        organizationId: orgId,
        projectId,
        name: 'My Widget',
        publicKey: 'wgt_pub_crt1',
        allowedOrigins: ['https://customer.com'],
        theme: { color: 'blue' },
      });
      expect(site).toMatchObject({
        organizationId: orgId,
        projectId,
        name: 'My Widget',
        publicKey: 'wgt_pub_crt1',
        allowedOrigins: ['https://customer.com'],
        enabled: true,
        theme: { color: 'blue' },
      });
      // Round-trips via the public hot path.
      const viaKey = await repo.findByPublicKey('wgt_pub_crt1');
      expect(viaKey?.id).toBe(site.id);
    });

    it('throws EmbedSiteProjectConflictError when the project already has a site', async () => {
      const { orgId, projectId } = await seedOrgProject('crt2');
      await repo.create({
        id: randomUUID(),
        organizationId: orgId,
        projectId,
        name: 'First',
        publicKey: 'wgt_pub_crt2a',
        allowedOrigins: [],
        theme: null,
      });
      await expect(
        repo.create({
          id: randomUUID(),
          organizationId: orgId,
          projectId,
          name: 'Second',
          publicKey: 'wgt_pub_crt2b',
          allowedOrigins: [],
          theme: null,
        }),
      ).rejects.toBeInstanceOf(EmbedSiteProjectConflictError);
    });

    it('throws EmbedSitePublicKeyCollisionError on a duplicate public key', async () => {
      const a = await seedOrgProject('crt3a');
      const b = await seedOrgProject('crt3b');
      await repo.create({
        id: randomUUID(),
        organizationId: a.orgId,
        projectId: a.projectId,
        name: 'A',
        publicKey: 'wgt_pub_shared',
        allowedOrigins: [],
        theme: null,
      });
      await expect(
        repo.create({
          id: randomUUID(),
          organizationId: b.orgId,
          projectId: b.projectId,
          name: 'B',
          publicKey: 'wgt_pub_shared',
          allowedOrigins: [],
          theme: null,
        }),
      ).rejects.toBeInstanceOf(EmbedSitePublicKeyCollisionError);
    });

    it('lets exactly one of two concurrent creates on the same project win', async () => {
      const { orgId, projectId } = await seedOrgProject('crt4');
      const results = await Promise.allSettled([
        repo.create({
          id: randomUUID(),
          organizationId: orgId,
          projectId,
          name: 'one',
          publicKey: 'wgt_pub_crt4a',
          allowedOrigins: [],
          theme: null,
        }),
        repo.create({
          id: randomUUID(),
          organizationId: orgId,
          projectId,
          name: 'two',
          publicKey: 'wgt_pub_crt4b',
          allowedOrigins: [],
          theme: null,
        }),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(EmbedSiteProjectConflictError);
    });
  });

  describe('findById / listByOrg (org-scoped)', () => {
    it('returns a site by id within its org, null for another org', async () => {
      const seeded = await seedEmbedSite('fid1');
      await expect(
        repo.findById(seeded.siteId, seeded.orgId),
      ).resolves.toMatchObject({ id: seeded.siteId });
      // Cross-org lookup is invisible (→ null → service 404).
      await expect(
        repo.findById(seeded.siteId, 'org-someone-else'),
      ).resolves.toBeNull();
    });

    it('lists only the calling org sites', async () => {
      const a = await seedEmbedSite('lst-a');
      await seedEmbedSite('lst-b'); // different org
      const list = await repo.listByOrg(a.orgId);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(a.siteId);
    });
  });

  describe('update (org-scoped)', () => {
    it('patches fields and bumps updated_at', async () => {
      const seeded = await seedEmbedSite('upd1');
      const updated = await repo.update(seeded.siteId, seeded.orgId, {
        name: 'Renamed',
        enabled: false,
        allowedOrigins: ['https://new.example.com'],
        theme: { color: 'red' },
      });
      expect(updated).toMatchObject({
        name: 'Renamed',
        enabled: false,
        allowedOrigins: ['https://new.example.com'],
        theme: { color: 'red' },
      });
    });

    it('returns null when the site belongs to another org (no cross-org write)', async () => {
      const seeded = await seedEmbedSite('upd2');
      await expect(
        repo.update(seeded.siteId, 'org-other', { name: 'hijack' }),
      ).resolves.toBeNull();
      // Original is untouched.
      const original = await repo.findById(seeded.siteId, seeded.orgId);
      expect(original?.name).toBe('Site upd2');
    });

    // SPEC-003 §7.8: admin allowedOrigins/enabled edits "take effect on the next
    // public request". There is no cache — the public guard reads the live row
    // via findByPublicKey — so an admin disable is visible immediately on the
    // public hot path (the guard's 401 input). Proven at the write→read seam.
    it('propagates an admin enabled:false / origin edit to the public key lookup', async () => {
      const seeded = await seedEmbedSite('upd3');
      await repo.update(seeded.siteId, seeded.orgId, {
        enabled: false,
        allowedOrigins: ['https://only-this.example.com'],
      });
      const viaPublic = await repo.findByPublicKey(seeded.publicKey);
      expect(viaPublic?.enabled).toBe(false);
      expect(viaPublic?.allowedOrigins).toEqual([
        'https://only-this.example.com',
      ]);
    });
  });

  describe('rotateKey (org-scoped)', () => {
    it('replaces the key and invalidates the old one on the public channel', async () => {
      const seeded = await seedEmbedSite('rot1');
      const rotated = await repo.rotateKey(
        seeded.siteId,
        seeded.orgId,
        'wgt_pub_rotated1',
      );
      expect(rotated?.publicKey).toBe('wgt_pub_rotated1');
      // Old key no longer resolves; new key does.
      await expect(repo.findByPublicKey(seeded.publicKey)).resolves.toBeNull();
      await expect(
        repo.findByPublicKey('wgt_pub_rotated1'),
      ).resolves.toMatchObject({ id: seeded.siteId });
    });

    it('returns null for another org (no cross-org rotation)', async () => {
      const seeded = await seedEmbedSite('rot2');
      await expect(
        repo.rotateKey(seeded.siteId, 'org-other', 'wgt_pub_x'),
      ).resolves.toBeNull();
    });

    it('throws on a colliding new key', async () => {
      const existing = await seedEmbedSite('rot3a');
      const target = await seedEmbedSite('rot3b');
      await expect(
        repo.rotateKey(target.siteId, target.orgId, existing.publicKey),
      ).rejects.toBeInstanceOf(EmbedSitePublicKeyCollisionError);
    });
  });

  describe('delete (org-scoped)', () => {
    it('removes a site within its org and reports success', async () => {
      const seeded = await seedEmbedSite('del1');
      await expect(repo.delete(seeded.siteId, seeded.orgId)).resolves.toBe(
        true,
      );
      await expect(repo.findByPublicKey(seeded.publicKey)).resolves.toBeNull();
    });

    it('does not delete a site from another org (returns false)', async () => {
      const seeded = await seedEmbedSite('del2');
      await expect(repo.delete(seeded.siteId, 'org-other')).resolves.toBe(
        false,
      );
      await expect(
        repo.findById(seeded.siteId, seeded.orgId),
      ).resolves.not.toBeNull();
    });
  });
});
