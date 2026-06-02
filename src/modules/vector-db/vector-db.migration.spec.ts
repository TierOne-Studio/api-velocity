import { jest } from '@jest/globals';
import type { DatabaseService } from '../../shared/infrastructure/database/database.module';
import { VectorDbMigrationService } from './vector-db.migration';

describe('VectorDbMigrationService', () => {
  let db: jest.Mocked<DatabaseService>;
  let service: VectorDbMigrationService;
  let infoSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    db = {
      query: jest.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
      hasMigrationRun: jest.fn<() => Promise<boolean>>().mockResolvedValue(false),
      recordMigration: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DatabaseService>;
    service = new VectorDbMigrationService(db);
    infoSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('runs the migration on a fresh database', async () => {
    await service.runTrackedMigrations();

    expect(db.recordMigration).toHaveBeenCalledWith(
      'vector_db_001_create_org_vector_db',
    );
  });

  it('skips the migration when it has already run', async () => {
    db.hasMigrationRun.mockResolvedValue(true);
    await service.runTrackedMigrations();
    expect(db.recordMigration).not.toHaveBeenCalled();
  });

  it('is idempotent: second call with all-run flag skips everything', async () => {
    await service.runTrackedMigrations();
    expect(db.recordMigration).toHaveBeenCalledTimes(1);

    db.hasMigrationRun.mockResolvedValue(true);
    db.recordMigration.mockClear();
    await service.runTrackedMigrations();
    expect(db.recordMigration).not.toHaveBeenCalled();
  });

  it('createTable emits CREATE TABLE with status CHECK constraint', async () => {
    await service.createTable();

    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /CREATE TABLE IF NOT EXISTS org_vector_db/i,
      ),
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /status IN \('empty','processing','ready','error'\)/,
      ),
    );
  });

  it('createTable creates the unique name index', async () => {
    await service.createTable();

    const calls = (db.query as jest.Mock).mock.calls.map(
      (args) => (args as unknown[])[0] as string,
    );
    expect(calls.some((sql) => /idx_org_vector_db_name/.test(sql))).toBe(true);
  });
});
