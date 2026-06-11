// Integration spec for the Slice-5 vector_db data-source pieces — runs every
// statement against a REAL ephemeral Postgres (testcontainers), NOT mocks.
// Mirrors the testcontainers convention established by
// providers/database/postgres-roundtrip.smoke.spec.ts.
//
// Covers two data/RBAC-bound criteria that a mocked `sql.toContain` assertion
// could not (those are vacuous per CLAUDE.md P8.0):
//   1. The projects_004 migration widens the project_data_source.kind CHECK to
//      admit 'vector_db', still rejects unknown kinds, and is authoritative
//      (drops a pre-existing stray 'qdrant_collection' value).
//   2. ProjectsDatabaseRepository.findProjectsReferencingVectorDb is scoped to
//      the organization (the inverted reference query of ADR-013 Decision 9).

import { jest } from '@jest/globals';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { ProjectsMigrationService } from './projects.migration';
import { ProjectsDatabaseRepository } from './infrastructure/persistence/repositories/projects.database-repository';
import type { DatabaseService } from '../../shared/infrastructure/database/database.module';

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

async function seedOrgWithProject(
  pool: Pool,
  label: string,
): Promise<{ orgId: string; userId: string; projectId: string }> {
  const suffix = label;
  const orgId = `org-${suffix}`;
  const userId = `user-${suffix}`;
  const projectId = randomUUID();
  await pool.query(`INSERT INTO organization (id) VALUES ($1)`, [orgId]);
  await pool.query(`INSERT INTO "user" (id) VALUES ($1)`, [userId]);
  await pool.query(
    `INSERT INTO project (id, organization_id, name, created_by_user_id)
     VALUES ($1, $2, $3, $4)`,
    [projectId, orgId, `Project ${suffix}`, userId],
  );
  return { orgId, userId, projectId };
}

describe('Slice 5 vector_db — real Postgres', () => {
  jest.setTimeout(120_000);
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let migration: ProjectsMigrationService;
  let repo: ProjectsDatabaseRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    const db = makeDb(pool);
    migration = new ProjectsMigrationService(db);
    repo = new ProjectsDatabaseRepository(db);

    // FK targets for the project table (minimal stubs).
    await pool.query(`CREATE TABLE organization (id TEXT PRIMARY KEY)`);
    await pool.query(`CREATE TABLE "user" (id TEXT PRIMARY KEY)`);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (container) await container.stop();
  });

  describe('projects_004 migration — kind CHECK constraint', () => {
    beforeEach(async () => {
      await pool.query(`DROP TABLE IF EXISTS project_data_source CASCADE`);
      await pool.query(`DROP TABLE IF EXISTS project CASCADE`);
    });

    async function createProjectTableWithKinds(kinds: string[]): Promise<void> {
      // Simulate a pre-migration table whose CHECK lists `kinds`.
      const list = kinds.map((k) => `'${k}'`).join(', ');
      await pool.query(`
        CREATE TABLE project (
          id UUID PRIMARY KEY,
          organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_by_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
        )
      `);
      await pool.query(`
        CREATE TABLE project_data_source (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CONSTRAINT project_data_source_kind_check CHECK (kind IN (${list})),
          name TEXT NOT NULL,
          config JSONB NOT NULL DEFAULT '{}'::jsonb,
          status TEXT NOT NULL DEFAULT 'ready',
          status_detail TEXT
        )
      `);
    }

    async function insertSource(
      projectId: string,
      kind: string,
    ): Promise<void> {
      await pool.query(
        `INSERT INTO project_data_source (id, project_id, kind, name)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), projectId, kind, `src-${kind}`],
      );
    }

    it('rejects vector_db before the migration, accepts it after', async () => {
      await createProjectTableWithKinds([
        'airweave_collection',
        'database',
        'external',
      ]);
      const { projectId } = await seedOrgWithProject(pool, 'mig1');

      await expect(insertSource(projectId, 'vector_db')).rejects.toThrow(
        /project_data_source_kind_check/,
      );

      await migration.extendKindConstraintForVectorDb();

      await expect(
        insertSource(projectId, 'vector_db'),
      ).resolves.toBeUndefined();
    });

    it('still rejects an unknown kind after the migration', async () => {
      await createProjectTableWithKinds([
        'airweave_collection',
        'database',
        'external',
      ]);
      const { projectId } = await seedOrgWithProject(pool, 'mig2');

      await migration.extendKindConstraintForVectorDb();

      await expect(insertSource(projectId, 'totally_bogus')).rejects.toThrow(
        /project_data_source_kind_check/,
      );
    });

    it('is authoritative — drops a stray qdrant_collection kind value', async () => {
      // Some dev DBs accumulated 'qdrant_collection' that no tracked migration
      // ever defined. The authoritative re-add must remove it.
      await createProjectTableWithKinds([
        'airweave_collection',
        'database',
        'external',
        'qdrant_collection',
      ]);
      const { projectId } = await seedOrgWithProject(pool, 'mig3');

      await migration.extendKindConstraintForVectorDb();

      await expect(
        insertSource(projectId, 'qdrant_collection'),
      ).rejects.toThrow(/project_data_source_kind_check/);
      await expect(
        insertSource(projectId, 'vector_db'),
      ).resolves.toBeUndefined();
    });
  });

  describe('findProjectsReferencingVectorDb — org-scoped', () => {
    beforeAll(async () => {
      // Build the canonical schema (inline CHECK already includes vector_db).
      await pool.query(`DROP TABLE IF EXISTS project_data_source CASCADE`);
      await pool.query(`DROP TABLE IF EXISTS project CASCADE`);
      await migration.createProjectTables();
    });

    it('returns only same-org projects referencing the vector database', async () => {
      const vectorDbId = randomUUID();
      const orgA = await seedOrgWithProject(pool, 'refA');
      const orgB = await seedOrgWithProject(pool, 'refB');

      // Both orgs attach the SAME vectorDbId (cross-org id collision is the
      // exact case org-scoping must isolate).
      for (const { projectId } of [orgA, orgB]) {
        await pool.query(
          `INSERT INTO project_data_source (id, project_id, kind, name, config)
           VALUES ($1, $2, 'vector_db', 'KB', $3::jsonb)`,
          [
            randomUUID(),
            projectId,
            JSON.stringify({ vectorDbId, vectorDbName: 'KB' }),
          ],
        );
      }

      const refsA = await repo.findProjectsReferencingVectorDb(
        vectorDbId,
        orgA.orgId,
      );
      expect(refsA).toEqual([{ id: orgA.projectId, name: 'Project refA' }]);
    });

    it('returns an empty list when no project references the vector database', async () => {
      const orgC = await seedOrgWithProject(pool, 'refC');
      const refs = await repo.findProjectsReferencingVectorDb(
        randomUUID(),
        orgC.orgId,
      );
      expect(refs).toEqual([]);
    });
  });
});
