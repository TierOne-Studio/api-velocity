import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../shared/infrastructure/database/database.module';
import { ProjectsMigrationService } from '../projects/projects.migration';

/**
 * Tracked, idempotent migrations for the embed-sites module. Mirrors
 * ChatMigrationService: driven from OnModuleInit, ordered AFTER the projects
 * migrations because `embed_site.project_id` FKs `project(id)`. EmbedSitesModule
 * MUST be imported after ProjectsModule in app.module.ts (the established
 * module-import-order coupling).
 */
@Injectable()
export class EmbedSitesMigrationService implements OnModuleInit {
  private readonly logger = new Logger(EmbedSitesMigrationService.name);

  constructor(
    private readonly db: DatabaseService,
    // Injected to drive projects' migrations before ours; ProjectsMigrationService
    // is idempotent (its tracking table prevents double-run).
    private readonly projectsMigrations: ProjectsMigrationService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.projectsMigrations.runTrackedMigrations();
    await this.runTrackedMigrations();
  }

  async runTrackedMigrations(): Promise<void> {
    const migrations = [
      {
        name: 'embed_site_001_create_embed_site_table',
        up: () => this.createEmbedSiteTable(),
      },
      {
        name: 'embed_site_002_create_embed_usage_counter_table',
        up: () => this.createEmbedUsageCounterTable(),
      },
    ];

    let pendingCount = 0;
    for (const migration of migrations) {
      if (await this.db.hasMigrationRun(migration.name)) continue;
      await migration.up();
      await this.db.recordMigration(migration.name);
      pendingCount++;
      this.logger.log(`↳ Migration ${migration.name} applied`);
    }

    this.logger.log(
      pendingCount > 0
        ? `Embed-sites migrations completed (${pendingCount} new)`
        : 'Embed-sites migrations up to date',
    );
  }

  async createEmbedSiteTable(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS embed_site (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        project_id      UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        public_key      TEXT NOT NULL,
        allowed_origins TEXT[] NOT NULL DEFAULT '{}',
        enabled         BOOLEAN NOT NULL DEFAULT TRUE,
        theme           JSONB,
        created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await this.db.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_embed_site_public_key ON embed_site(public_key)`,
    );
    await this.db.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_embed_site_project ON embed_site(project_id)`,
    );
    await this.db.query(
      `CREATE INDEX IF NOT EXISTS idx_embed_site_org ON embed_site(organization_id)`,
    );
  }

  async createEmbedUsageCounterTable(): Promise<void> {
    // Durable monthly cost-cap counter (SPEC-003 §9.6). One row per
    // (organization_id, window_start); atomic upsert-increment on the public path.
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS embed_usage_counter (
        organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        window_start    DATE NOT NULL,
        request_count   BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (organization_id, window_start)
      )
    `);
  }
}
