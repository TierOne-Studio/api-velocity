import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../shared/infrastructure/database/database.module';

@Injectable()
export class VectordbMigrationService implements OnModuleInit {
  constructor(private readonly db: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.runTrackedMigrations();
  }

  async runTrackedMigrations(): Promise<void> {
    const migrations = [
      {
        name: 'vectordb_001_create_org_vectordb',
        up: () => this.createTable(),
      },
    ];

    let pending = 0;
    for (const migration of migrations) {
      if (await this.db.hasMigrationRun(migration.name)) continue;
      await migration.up();
      await this.db.recordMigration(migration.name);
      pending++;
      console.log(`  ↳ Migration ${migration.name} applied`);
    }

    if (pending > 0) {
      console.log(`✅ Knowledge base migrations completed (${pending} new)`);
    } else {
      console.log('✅ Knowledge base migrations up to date');
    }
  }

  async createTable(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS org_vectordb (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NULL,
        qdrant_collection TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'empty'
          CHECK (status IN ('empty','processing','ready','error')),
        status_error TEXT NULL,
        document_count INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.db.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_org_vectordb_name
         ON org_vectordb(organization_id, name)`,
    );
    await this.db.query(
      `CREATE INDEX IF NOT EXISTS idx_org_vectordb_org_status
         ON org_vectordb(organization_id, status)`,
    );
  }

  async down(): Promise<void> {
    await this.db.query(`DROP INDEX IF EXISTS idx_org_vectordb_org_status`);
    await this.db.query(`DROP INDEX IF EXISTS idx_org_vectordb_name`);
    await this.db.query(`DROP TABLE IF EXISTS org_vectordb`);
  }
}
