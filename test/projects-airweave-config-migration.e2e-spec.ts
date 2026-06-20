import { Pool } from 'pg';
import { DatabaseService } from '../src/shared/infrastructure/database/database.module';
import { ProjectsMigrationService } from '../src/modules/projects/projects.migration';
import { ProjectsDatabaseRepository } from '../src/modules/projects/infrastructure/persistence/repositories/projects.database-repository';

/**
 * BE-1 — projects_005_rename_airweave_config_keys (Airweave Collections rename).
 *
 * Verifies the forward data-migration that renames the persisted
 * `project_data_source.config` JSON keys `collectionReadableId`/`collectionName`
 * → `airweaveCollectionReadableId`/`airweaveCollectionName` for
 * `kind='airweave_collection'` rows. Runs against the real test Postgres
 * (.env.test → DATABASE_URL) and exercises every data variant the plan
 * enumerated (both keys / partial / empty / non-airweave / idempotent).
 */
describe('projects_005 rename airweave config keys (e2e, real Postgres)', () => {
  let pool: Pool;
  let db: DatabaseService;
  let migration: ProjectsMigrationService;

  const orgId = `e2e-aw-cfg-org-${Date.now()}`;
  const userId = `e2e-aw-cfg-user-${Date.now()}`;
  let projectId: string;

  // ids of the seeded data-source rows, by variant
  const ids: Record<'both' | 'partial' | 'empty' | 'nonAirweave', string> = {
    both: '',
    partial: '',
    empty: '',
    nonAirweave: '',
  };

  const readConfig = async (id: string): Promise<Record<string, unknown>> => {
    const row = await db.queryOne<{ config: Record<string, unknown> }>(
      `SELECT config FROM project_data_source WHERE id = $1`,
      [id],
    );
    return row.config;
  };

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL not set (.env.test)');
    pool = new Pool({ connectionString: databaseUrl });
    db = new DatabaseService(pool);
    migration = new ProjectsMigrationService(db);

    // Minimal FK chain: org → user → project.
    await db.query(
      `INSERT INTO organization (id, name, slug) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [orgId, 'E2E AW Cfg Org', orgId],
    );
    await db.query(
      `INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [userId, 'E2E AW Cfg User', `${userId}@example.test`],
    );
    const project = await db.queryOne<{ id: string }>(
      `INSERT INTO project (organization_id, name, created_by_user_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [orgId, 'E2E AW Cfg Project', userId],
    );
    projectId = project.id;

    const seed = async (
      kind: string,
      config: Record<string, unknown>,
    ): Promise<string> => {
      const row = await db.queryOne<{ id: string }>(
        `INSERT INTO project_data_source (project_id, kind, name, config)
         VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
        [projectId, kind, 'seed', JSON.stringify(config)],
      );
      return row.id;
    };

    ids.both = await seed('airweave_collection', {
      collectionReadableId: 'kb-both',
      collectionName: 'KB Both',
    });
    ids.partial = await seed('airweave_collection', {
      collectionReadableId: 'kb-partial',
    });
    ids.empty = await seed('airweave_collection', {});
    ids.nonAirweave = await seed('database', { connectionId: 'conn-1' });
  });

  afterAll(async () => {
    // organization ON DELETE CASCADE → project → project_data_source.
    if (db) {
      await db.query(`DELETE FROM organization WHERE id = $1`, [orgId]);
      await db.query(`DELETE FROM "user" WHERE id = $1`, [userId]);
    }
    if (pool) await pool.end();
  });

  it('renames both keys, preserving values, removing old keys', async () => {
    await migration.renameAirweaveConfigKeys();
    const config = await readConfig(ids.both);
    expect(config).toEqual({
      airweaveCollectionReadableId: 'kb-both',
      airweaveCollectionName: 'KB Both',
    });
    expect(config).not.toHaveProperty('collectionReadableId');
    expect(config).not.toHaveProperty('collectionName');
  });

  it('partial row: renames present key, does NOT inject a null for the absent key', async () => {
    const config = await readConfig(ids.partial);
    expect(config).toEqual({ airweaveCollectionReadableId: 'kb-partial' });
    expect(config).not.toHaveProperty('airweaveCollectionName');
    expect(config).not.toHaveProperty('collectionReadableId');
  });

  it('empty config is left untouched (no keys injected)', async () => {
    const config = await readConfig(ids.empty);
    expect(config).toEqual({});
  });

  it('non-airweave_collection rows are untouched', async () => {
    const config = await readConfig(ids.nonAirweave);
    expect(config).toEqual({ connectionId: 'conn-1' });
  });

  it('is idempotent: a second run changes nothing', async () => {
    const before = await readConfig(ids.both);
    await migration.renameAirweaveConfigKeys();
    const after = await readConfig(ids.both);
    expect(after).toEqual(before);
    expect(after).toEqual({
      airweaveCollectionReadableId: 'kb-both',
      airweaveCollectionName: 'KB Both',
    });
  });

  // Non-vacuous runtime-read coverage: the repo's `config->>'airweaveCollectionReadableId'`
  // predicate must resolve a real post-rename row. Reverting the key at
  // projects.database-repository.ts → returns [] → fails.
  it('repo.findProjectsReferencingAirweaveCollection matches a real airweaveCollectionReadableId row', async () => {
    await db.query(
      `INSERT INTO project_data_source (project_id, kind, name, config)
       VALUES ($1, 'airweave_collection', 'rt', $2::jsonb)`,
      [
        projectId,
        JSON.stringify({
          airweaveCollectionReadableId: 'kb-runtime',
          airweaveCollectionName: 'RT',
        }),
      ],
    );
    const repo = new ProjectsDatabaseRepository(db);

    const refs = await repo.findProjectsReferencingAirweaveCollection(
      'kb-runtime',
      orgId,
    );
    expect(refs).toEqual([{ id: projectId, name: 'E2E AW Cfg Project' }]);

    const none = await repo.findProjectsReferencingAirweaveCollection(
      'does-not-exist',
      orgId,
    );
    expect(none).toEqual([]);
  });
});
