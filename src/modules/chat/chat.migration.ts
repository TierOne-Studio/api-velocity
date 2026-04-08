import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../shared/infrastructure/database/database.module';

@Injectable()
export class ChatMigrationService implements OnModuleInit {
  constructor(private readonly db: DatabaseService) {}

  async onModuleInit() {
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
        up: () => this.removeProjectScopeFromConversation(),
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

  async removeProjectScopeFromConversation(): Promise<void> {
    await this.db.query('DROP INDEX IF EXISTS idx_conversation_project');
    await this.db.query(`
      ALTER TABLE conversation
      DROP COLUMN IF EXISTS project_id
    `);
  }
}
