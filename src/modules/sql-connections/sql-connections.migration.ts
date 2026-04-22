import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../shared/infrastructure/database/database.module';

@Injectable()
export class SqlConnectionsMigrationService implements OnModuleInit {
  constructor(private readonly db: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.runTrackedMigrations();
  }

  async runTrackedMigrations(): Promise<void> {
    const migrations = [
      {
        name: 'sql_connections_001_create_org_sql_connection',
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
      console.log(`✅ SQL connections migrations completed (${pending} new)`);
    } else {
      console.log('✅ SQL connections migrations up to date');
    }
  }

  async createTable(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS org_sql_connection (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INT NOT NULL,
        database TEXT NOT NULL,
        username TEXT NOT NULL,
        password_ciphertext TEXT NOT NULL,
        password_iv TEXT NOT NULL,
        password_tag TEXT NOT NULL,
        ssl JSONB NOT NULL DEFAULT 'false'::jsonb,
        schema_name TEXT NOT NULL DEFAULT 'public',
        status TEXT NOT NULL DEFAULT 'connecting'
          CHECK (status IN ('connecting','ready','error')),
        status_error TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.db.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_org_sql_connection_org_name
         ON org_sql_connection(organization_id, name)`,
    );
    await this.db.query(
      `CREATE INDEX IF NOT EXISTS idx_org_sql_connection_org_status
         ON org_sql_connection(organization_id, status)`,
    );
  }

  /**
   * Reversible down-migration. Not wired into OnModuleInit — call explicitly
   * from a maintenance script (e.g. migration:revert) if you need it.
   */
  async down(): Promise<void> {
    await this.db.query(
      `DROP INDEX IF EXISTS idx_org_sql_connection_org_status`,
    );
    await this.db.query(`DROP INDEX IF EXISTS idx_org_sql_connection_org_name`);
    await this.db.query(`DROP TABLE IF EXISTS org_sql_connection`);
  }
}
