import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../shared/infrastructure/database/database.module';
import { ProjectsMigrationService } from '../projects/projects.migration';

@Injectable()
export class ChatMigrationService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    // Injected so we can explicitly drive ProjectsMigrationService's migrations
    // before our own. Nest's lifecycle hooks run after all providers construct,
    // so injection alone doesn't guarantee onModuleInit() ordering — we invoke
    // runTrackedMigrations() directly below. ProjectsMigrationService is
    // idempotent (its tracking table prevents double-run) so calling it here
    // AND from its own onModuleInit is safe.
    private readonly projectsMigrations: ProjectsMigrationService,
  ) {}

  async onModuleInit() {
    // Ensure the `project` table exists and organizations are backfilled
    // before we add/backfill conversation.project_id.
    await this.projectsMigrations.runTrackedMigrations();
    await this.runTrackedMigrations();
  }

  async runTrackedMigrations(): Promise<void> {
    const migrations = [
      {
        name: 'chat_001_create_conversation_and_message_tables',
        up: () => this.createConversationAndMessageTables(),
      },
      {
        name: 'chat_002_remove_project_scope_from_conversation',
        up: () => this.removeLegacyProjectScope(),
      },
      {
        name: 'chat_003_add_project_id_to_conversation',
        up: () => this.addProjectIdToConversation(),
      },
      {
        name: 'chat_004_backfill_conversation_project_id',
        up: () => this.backfillConversationProjectId(),
      },
      {
        name: 'chat_005_enforce_conversation_project_id_not_null',
        up: () => this.enforceConversationProjectIdNotNull(),
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
      console.log(`✅ Chat migrations completed (${pendingCount} new)`);
    } else {
      console.log('✅ Chat migrations up to date');
    }
  }

  async createConversationAndMessageTables(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS conversation (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT,
        organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await this.db.query(
      'CREATE INDEX IF NOT EXISTS idx_conversation_user ON conversation(user_id)',
    );
    await this.db.query(
      'CREATE INDEX IF NOT EXISTS idx_conversation_org ON conversation(organization_id)',
    );

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS message (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await this.db.query(
      'CREATE INDEX IF NOT EXISTS idx_message_conversation ON message(conversation_id)',
    );
    await this.db.query(
      'CREATE INDEX IF NOT EXISTS idx_message_created ON message(conversation_id, created_at)',
    );
  }

  async removeLegacyProjectScope(): Promise<void> {
    await this.db.query('DROP INDEX IF EXISTS idx_conversation_project');
    await this.db.query(`
      ALTER TABLE conversation
      DROP COLUMN IF EXISTS project_id
    `);
  }

  async addProjectIdToConversation(): Promise<void> {
    await this.db.query(`
      ALTER TABLE conversation
      ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES project(id) ON DELETE CASCADE
    `);
    await this.db.query(
      'CREATE INDEX IF NOT EXISTS idx_conversation_project ON conversation(project_id)',
    );
  }

  async backfillConversationProjectId(): Promise<void> {
    await this.db.query(`
      UPDATE conversation c
         SET project_id = p.id
        FROM project p
       WHERE c.project_id IS NULL
         AND p.organization_id = c.organization_id
         AND p.name = 'General'
    `);
  }

  async enforceConversationProjectIdNotNull(): Promise<void> {
    const orphaned = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM conversation WHERE project_id IS NULL`,
    );
    if (orphaned && Number(orphaned.count) > 0) {
      console.warn(
        `[chat-migration] ${orphaned.count} conversations still have NULL project_id; skipping NOT NULL enforcement`,
      );
      return;
    }
    await this.db.query(`
      ALTER TABLE conversation ALTER COLUMN project_id SET NOT NULL
    `);
  }
}
