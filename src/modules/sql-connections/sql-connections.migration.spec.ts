import { jest } from '@jest/globals';
import type { DatabaseService } from '../../shared/infrastructure/database/database.module';
import { SqlConnectionsMigrationService } from './sql-connections.migration';

describe('SqlConnectionsMigrationService', () => {
  let db: jest.Mocked<DatabaseService>;
  let service: SqlConnectionsMigrationService;
  let infoSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    db = {
      query: jest.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
      hasMigrationRun: jest.fn<() => Promise<boolean>>().mockResolvedValue(false),
      recordMigration: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DatabaseService>;
    service = new SqlConnectionsMigrationService(db);
    infoSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('runs both migrations on a fresh database', async () => {
    await service.runTrackedMigrations();

    expect(db.recordMigration).toHaveBeenCalledWith(
      'sql_connections_001_create_org_sql_connection',
    );
    expect(db.recordMigration).toHaveBeenCalledWith(
      'sql_connections_002_add_allowed_tables',
    );
  });

  it('skips both migrations when they have already run', async () => {
    db.hasMigrationRun.mockResolvedValue(true);
    await service.runTrackedMigrations();
    expect(db.recordMigration).not.toHaveBeenCalled();
  });

  it('H1a: emits ALTER TABLE ADD COLUMN allowed_tables JSONB NULL', async () => {
    await service.addAllowedTablesColumn();
    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /ALTER TABLE org_sql_connection[\s\S]+ADD COLUMN IF NOT EXISTS allowed_tables JSONB NULL/i,
      ),
    );
  });

  it('H1a: the migration runs ONLY after 001 has been applied (idempotency)', async () => {
    // First call: both run.
    await service.runTrackedMigrations();
    expect(db.recordMigration).toHaveBeenCalledTimes(2);

    // Second call: hasMigrationRun returns true → no re-run.
    db.hasMigrationRun.mockResolvedValue(true);
    db.recordMigration.mockClear();
    await service.runTrackedMigrations();
    expect(db.recordMigration).not.toHaveBeenCalled();
  });
});
