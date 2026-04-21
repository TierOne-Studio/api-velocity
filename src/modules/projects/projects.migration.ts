import { randomUUID } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../shared/infrastructure/database/database.module';

type OrganizationRow = {
  id: string;
  metadata: string | null;
};

type ProjectRow = {
  id: string;
  organization_id: string;
};

type UserRow = {
  id: string;
};

@Injectable()
export class ProjectsMigrationService implements OnModuleInit {
  constructor(private readonly db: DatabaseService) {}

  async onModuleInit() {
    await this.runTrackedMigrations();
  }

  async runTrackedMigrations(): Promise<void> {
    const migrations = [
      {
        name: 'projects_001_create_project_tables',
        up: () => this.createProjectTables(),
      },
      {
        name: 'projects_001a_ensure_project_columns',
        up: () => this.ensureProjectColumns(),
      },
      {
        name: 'projects_001b_ensure_project_constraints',
        up: () => this.ensureProjectConstraints(),
      },
      {
        name: 'projects_001c_reset_legacy_project_schema',
        up: () => this.resetLegacyProjectSchema(),
      },
      {
        name: 'projects_002_backfill_general_projects',
        up: () => this.backfillGeneralProjects(),
      },
      {
        name: 'projects_003_seed_airweave_allowlist',
        up: () => this.seedAirweaveAllowlist(),
      },
    ];

    let pendingCount = 0;
    for (const migration of migrations) {
      const hasRun = await this.db.hasMigrationRun(migration.name);
      if (!hasRun) {
        await migration.up();
        await this.db.recordMigration(migration.name);
        pendingCount++;
        console.log(`  ↳ Migration ${migration.name} applied`);
      }
    }

    if (pendingCount > 0) {
      console.log(`✅ Projects migrations completed (${pendingCount} new)`);
    } else {
      console.log('✅ Projects migrations up to date');
    }
  }

  async createProjectTables(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS project (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        created_by_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT project_org_name_unique UNIQUE (organization_id, name)
      )
    `);

    await this.db.query(
      `CREATE INDEX IF NOT EXISTS idx_project_org ON project(organization_id)`,
    );

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS project_data_source (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('airweave_collection', 'database', 'external')),
        name TEXT NOT NULL,
        config JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'ready',
        status_detail TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await this.db.query(
      `CREATE INDEX IF NOT EXISTS idx_project_data_source_project ON project_data_source(project_id)`,
    );
  }

  async backfillGeneralProjects(): Promise<void> {
    const organizations = await this.db.query<OrganizationRow>(
      `SELECT id, metadata FROM organization`,
    );

    for (const org of organizations) {
      const existing = await this.db.queryOne<ProjectRow>(
        `SELECT id, organization_id FROM project
           WHERE organization_id = $1 AND name = 'General'
           LIMIT 1`,
        [org.id],
      );

      const creator = await this.db.queryOne<UserRow>(
        `SELECT u.id FROM "user" u
           INNER JOIN member m ON m."userId" = u.id
          WHERE m."organizationId" = $1
          ORDER BY m."createdAt" ASC
          LIMIT 1`,
        [org.id],
      );

      if (!creator) {
        console.warn(
          `[projects-migration] Skipping General project for org ${org.id} (no members)`,
        );
        continue;
      }

      let projectId: string;
      if (existing) {
        projectId = existing.id;
      } else {
        projectId = randomUUID();
        await this.db.query(
          `INSERT INTO project (id, organization_id, name, description, created_by_user_id)
           VALUES ($1, $2, 'General', 'Auto-created during projects migration', $3)
           ON CONFLICT (organization_id, name) DO NOTHING`,
          [projectId, org.id, creator.id],
        );
      }

      const metadata = this.parseMetadata(org.metadata);
      const legacyCollectionId =
        typeof metadata?.airweaveCollectionId === 'string'
          ? metadata.airweaveCollectionId
          : null;

      if (legacyCollectionId) {
        const hasSource = await this.db.queryOne<{ id: string }>(
          `SELECT id FROM project_data_source
             WHERE project_id = $1
               AND kind = 'airweave_collection'
               AND config->>'collectionReadableId' = $2
             LIMIT 1`,
          [projectId, legacyCollectionId],
        );
        if (!hasSource) {
          await this.db.query(
            `INSERT INTO project_data_source
               (id, project_id, kind, name, config)
             VALUES ($1, $2, 'airweave_collection', $3, $4::jsonb)`,
            [
              randomUUID(),
              projectId,
              legacyCollectionId,
              JSON.stringify({
                collectionReadableId: legacyCollectionId,
                collectionName: legacyCollectionId,
              }),
            ],
          );
        }
      }
    }
  }

  async ensureProjectColumns(): Promise<void> {
    // Reconcile stale `project` tables from earlier iterations.
    const hasCreatorColumn = await this.db.queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'project' AND column_name = 'created_by_user_id'
       ) AS "exists"`,
    );

    if (hasCreatorColumn?.exists) return;

    // Earlier iterations of this feature shipped divergent schemas. A clean
    // drop + rebuild is the safest reconciliation — the tables have no
    // production data yet, and the backfill step reseeds General projects.
    await this.db.query(`DROP TABLE IF EXISTS project_data_source CASCADE`);
    await this.db.query(`DROP TABLE IF EXISTS project CASCADE`);
    await this.createProjectTables();
  }

  async resetLegacyProjectSchema(): Promise<void> {
    // Detect columns that belonged to pre-plan iterations of the projects table
    // (e.g. `airweave_collection_id`, `discovery`) and, if found, rebuild the
    // table fresh. Backfill will reseed General projects on the next step.
    const legacyColumn = await this.db.queryOne<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'project'
           AND column_name IN ('airweave_collection_id', 'discovery', 'data_collection')
         LIMIT 1`,
    );

    if (!legacyColumn) return;

    await this.db.query(`DROP TABLE IF EXISTS project_data_source CASCADE`);
    await this.db.query(`DROP TABLE IF EXISTS project CASCADE`);
    await this.createProjectTables();
  }

  async ensureProjectConstraints(): Promise<void> {
    const hasUniqueConstraint = await this.db.queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conname = 'project_org_name_unique'
       ) AS "exists"`,
    );

    if (hasUniqueConstraint?.exists) return;

    await this.db.query(
      `ALTER TABLE project ADD CONSTRAINT project_org_name_unique UNIQUE (organization_id, name)`,
    );
  }

  async seedAirweaveAllowlist(): Promise<void> {
    const organizations = await this.db.query<OrganizationRow>(
      `SELECT id, metadata FROM organization`,
    );

    for (const org of organizations) {
      const metadata = this.parseMetadata(org.metadata) ?? {};
      const alreadySet = Array.isArray(metadata.allowedAirweaveCollectionIds);

      if (alreadySet) continue;

      const legacy =
        typeof metadata.airweaveCollectionId === 'string'
          ? [metadata.airweaveCollectionId]
          : [];

      const next = {
        ...metadata,
        allowedAirweaveCollectionIds: legacy,
      };

      await this.db.query(
        `UPDATE organization SET metadata = $1 WHERE id = $2`,
        [JSON.stringify(next), org.id],
      );
    }
  }

  private parseMetadata(
    metadata: string | null,
  ): Record<string, unknown> | null {
    if (!metadata) return null;
    try {
      const parsed: unknown = JSON.parse(metadata);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
}
