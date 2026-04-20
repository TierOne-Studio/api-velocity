import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../shared/infrastructure/database/database.module';
import { ProjectsMigrationService } from '../projects';
import { ChatMigrationService } from './chat.migration';

describe('ChatMigrationService', () => {
  let service: ChatMigrationService;
  let dbService: any;

  beforeEach(async () => {
    const queryMock: any = jest.fn();
    queryMock.mockResolvedValue([]);
    const queryOneMock: any = jest.fn();
    queryOneMock.mockResolvedValue({ count: '0' });
    const hasMigrationRunMock: any = jest.fn();
    hasMigrationRunMock.mockResolvedValue(false);
    const recordMigrationMock: any = jest.fn();
    recordMigrationMock.mockResolvedValue(undefined);

    dbService = {
      query: queryMock,
      queryOne: queryOneMock,
      hasMigrationRun: hasMigrationRunMock,
      recordMigration: recordMigrationMock,
    };

    const projectsMigrations = {
      runTrackedMigrations: jest.fn(),
    } as unknown as ProjectsMigrationService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatMigrationService,
        { provide: DatabaseService, useValue: dbService },
        { provide: ProjectsMigrationService, useValue: projectsMigrations },
      ],
    }).compile();

    service = module.get(ChatMigrationService);
  });

  it('runs the tracked chat migration when pending', async () => {
    const consoleSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);

    await service.runTrackedMigrations();

    const expected = [
      'chat_001_create_conversation_and_message_tables',
      'chat_002_remove_project_scope_from_conversation',
      'chat_003_add_project_id_to_conversation',
      'chat_004_backfill_conversation_project_id',
      'chat_005_enforce_conversation_project_id_not_null',
    ];
    for (const name of expected) {
      expect(dbService.hasMigrationRun).toHaveBeenCalledWith(name);
      expect(dbService.recordMigration).toHaveBeenCalledWith(name);
    }
    consoleSpy.mockRestore();
  });

  it('creates the conversation and message tables with indexes', async () => {
    await service.createConversationAndMessageTables();

    expect(dbService.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS conversation'),
    );
    expect(dbService.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS message'),
    );
    expect(dbService.query).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS idx_message_created ON message(conversation_id, created_at)',
    );
  });

  it('adds project_id column and index when applied', async () => {
    await service.addProjectIdToConversation();

    expect(dbService.query).toHaveBeenCalledWith(
      expect.stringContaining('ADD COLUMN IF NOT EXISTS project_id'),
    );
    expect(dbService.query).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS idx_conversation_project ON conversation(project_id)',
    );
  });

  it('backfills conversation.project_id from the org General project', async () => {
    await service.backfillConversationProjectId();

    expect(dbService.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "p.organization_id = c.organization_id\n         AND p.name = 'General'",
      ),
    );
  });

  it('enforces NOT NULL on project_id when no orphaned rows remain', async () => {
    await service.enforceConversationProjectIdNotNull();

    expect(dbService.queryOne).toHaveBeenCalledWith(
      expect.stringContaining('WHERE project_id IS NULL'),
    );
    expect(dbService.query).toHaveBeenCalledWith(
      expect.stringContaining('SET NOT NULL'),
    );
  });

  it('skips NOT NULL enforcement when orphaned rows exist', async () => {
    dbService.queryOne.mockResolvedValueOnce({ count: '3' });
    const consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await service.enforceConversationProjectIdNotNull();

    expect(dbService.query).not.toHaveBeenCalledWith(
      expect.stringContaining('SET NOT NULL'),
    );
    expect(consoleWarnSpy).toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it('logs "up to date" when all migrations have already run', async () => {
    const consoleSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);

    dbService.hasMigrationRun.mockResolvedValue(true);

    await service.runTrackedMigrations();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('up to date'),
    );
    consoleSpy.mockRestore();
  });
});
