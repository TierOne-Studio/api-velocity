import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../shared/infrastructure/database/database.module';
import { ChatMigrationService } from './chat.migration';

describe('ChatMigrationService', () => {
  let service: ChatMigrationService;
  let dbService: any;

  beforeEach(async () => {
    const queryMock: any = jest.fn();
    queryMock.mockResolvedValue([]);
    const hasMigrationRunMock: any = jest.fn();
    hasMigrationRunMock.mockResolvedValue(false);
    const recordMigrationMock: any = jest.fn();
    recordMigrationMock.mockResolvedValue(undefined);

    dbService = {
      query: queryMock,
      hasMigrationRun: hasMigrationRunMock,
      recordMigration: recordMigrationMock,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatMigrationService,
        { provide: DatabaseService, useValue: dbService },
      ],
    }).compile();

    service = module.get(ChatMigrationService);
  });

  it('runs the tracked chat migration when pending', async () => {
    const consoleSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);

    await service.runTrackedMigrations();

    expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
      'chat_001_create_conversation_and_message_tables',
    );
    expect(dbService.recordMigration).toHaveBeenCalledWith(
      'chat_001_create_conversation_and_message_tables',
    );
    expect(dbService.hasMigrationRun).toHaveBeenCalledWith(
      'chat_002_remove_project_scope_from_conversation',
    );
    expect(dbService.recordMigration).toHaveBeenCalledWith(
      'chat_002_remove_project_scope_from_conversation',
    );
    consoleSpy.mockRestore();
  });

  it('creates the conversation and message tables with indexes', async () => {
    await service.createConversationAndMessageTables();

    expect(dbService.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS conversation'),
    );
    expect(dbService.query).not.toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS idx_conversation_project ON conversation(project_id)',
    );
    expect(dbService.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS message'),
    );
    expect(dbService.query).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS idx_message_created ON message(conversation_id, created_at)',
    );
  });

  it('drops the legacy project-scoped conversation column for existing databases', async () => {
    await service.removeProjectScopeFromConversation();

    expect(dbService.query).toHaveBeenCalledWith(
      'DROP INDEX IF EXISTS idx_conversation_project',
    );
    expect(dbService.query).toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE conversation'),
    );
    expect(dbService.query).toHaveBeenCalledWith(
      expect.stringContaining('DROP COLUMN IF EXISTS project_id'),
    );
  });
});
