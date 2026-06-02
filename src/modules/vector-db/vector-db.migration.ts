import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../shared/infrastructure/database/database.module';

@Injectable()
export class VectorDbMigrationService implements OnModuleInit {
  constructor(private readonly db: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.runTrackedMigrations();
  }

  async runTrackedMigrations(): Promise<void> {
    const migrations = [
      {
        name: 'vector_db_001_create_org_vector_db',
        up: () => this.createTable(),
      },
      {
        name: 'vector_db_002_schema_improvements',
        up: () => this.addSchemaImprovements(),
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
      console.log(`✅ Vector DB migrations completed (${pending} new)`);
    } else {
      console.log('✅ Vector DB migrations up to date');
    }
  }

  async createTable(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS org_vector_db (
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
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_org_vector_db_name
         ON org_vector_db(organization_id, name)`,
    );
    await this.db.query(
      `CREATE INDEX IF NOT EXISTS idx_org_vector_db_org_status
         ON org_vector_db(organization_id, status)`,
    );
  }

  async addSchemaImprovements(): Promise<void> {
    // 1. Add storage-agnostic vector store columns, backfill from qdrant_collection, drop old column.
    await this.db.query(`
      ALTER TABLE org_vector_db
        ADD COLUMN IF NOT EXISTS vector_store_kind TEXT NOT NULL DEFAULT 'qdrant'
    `);
    await this.db.query(`
      ALTER TABLE org_vector_db
        ADD COLUMN IF NOT EXISTS vector_store_ref TEXT
    `);
    await this.db.query(`
      UPDATE org_vector_db
        SET vector_store_ref = qdrant_collection
        WHERE vector_store_ref IS NULL
    `);
    await this.db.query(`
      ALTER TABLE org_vector_db
        ALTER COLUMN vector_store_ref SET NOT NULL
    `);
    await this.db.query(`
      ALTER TABLE org_vector_db
        DROP COLUMN IF EXISTS qdrant_collection
    `);

    // 2. Convert status_error from TEXT to JSONB { message }.
    await this.db.query(`
      ALTER TABLE org_vector_db
        ADD COLUMN IF NOT EXISTS status_error_new JSONB NULL
    `);
    await this.db.query(`
      UPDATE org_vector_db
        SET status_error_new = jsonb_build_object('message', status_error)
        WHERE status_error IS NOT NULL
    `);
    await this.db.query(`
      ALTER TABLE org_vector_db
        DROP COLUMN IF EXISTS status_error
    `);
    await this.db.query(`
      ALTER TABLE org_vector_db
        RENAME COLUMN status_error_new TO status_error
    `);

    // 3. Add operational metadata columns needed by Slices 3–4.
    await this.db.query(`
      ALTER TABLE org_vector_db
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL
    `);
    await this.db.query(`
      ALTER TABLE org_vector_db
        ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 0
    `);
    await this.db.query(`
      ALTER TABLE org_vector_db
        ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ NULL
    `);
    await this.db.query(`
      ALTER TABLE org_vector_db
        ADD COLUMN IF NOT EXISTS last_ingested_at TIMESTAMPTZ NULL
    `);

    // 4. Tighten FK: CASCADE → RESTRICT so org deletes are blocked while VectorDbs exist.
    //    Async orphan cleanup (Qdrant collections, S3 blobs) is documented in ADR-013.
    await this.db.query(`
      ALTER TABLE org_vector_db
        DROP CONSTRAINT IF EXISTS org_vector_db_organization_id_fkey
    `);
    await this.db.query(`
      ALTER TABLE org_vector_db
        ADD CONSTRAINT org_vector_db_organization_id_fkey
        FOREIGN KEY (organization_id) REFERENCES organization(id) ON DELETE RESTRICT
    `);
  }

  async down(): Promise<void> {
    await this.db.query(`DROP INDEX IF EXISTS idx_org_vector_db_org_status`);
    await this.db.query(`DROP INDEX IF EXISTS idx_org_vector_db_name`);
    await this.db.query(`DROP TABLE IF EXISTS org_vector_db`);
  }
}
