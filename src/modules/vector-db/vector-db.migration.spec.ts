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
      hasMigrationRun: jest
        .fn<() => Promise<boolean>>()
        .mockResolvedValue(false),
      recordMigration: jest
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined),
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
    expect(db.recordMigration).toHaveBeenCalledTimes(3);

    db.hasMigrationRun.mockResolvedValue(true);
    db.recordMigration.mockClear();
    await service.runTrackedMigrations();
    expect(db.recordMigration).not.toHaveBeenCalled();
  });

  it('records vector_db_002_schema_improvements on a fresh database', async () => {
    await service.runTrackedMigrations();

    expect(db.recordMigration).toHaveBeenCalledWith(
      'vector_db_002_schema_improvements',
    );
  });

  it('skips 002 when it has already run', async () => {
    db.hasMigrationRun.mockImplementation(
      async (name) => name === 'vector_db_002_schema_improvements',
    );
    await service.runTrackedMigrations();

    expect(db.recordMigration).not.toHaveBeenCalledWith(
      'vector_db_002_schema_improvements',
    );
  });

  it('addSchemaImprovements adds vector_store_ref and drops qdrant_collection', async () => {
    await service.addSchemaImprovements();

    const calls = (db.query as jest.Mock).mock.calls.map(
      (args) => (args as unknown[])[0] as string,
    );
    expect(calls.some((sql) => /vector_store_ref/.test(sql))).toBe(true);
    expect(
      calls.some((sql) => /DROP COLUMN.*qdrant_collection/i.test(sql)),
    ).toBe(true);
  });

  it('addSchemaImprovements adds deleted_at and version columns', async () => {
    await service.addSchemaImprovements();

    const calls = (db.query as jest.Mock).mock.calls.map(
      (args) => (args as unknown[])[0] as string,
    );
    expect(calls.some((sql) => /deleted_at/.test(sql))).toBe(true);
    expect(calls.some((sql) => /version/.test(sql))).toBe(true);
  });

  it('addSchemaImprovements converts FK to ON DELETE RESTRICT', async () => {
    await service.addSchemaImprovements();

    const calls = (db.query as jest.Mock).mock.calls.map(
      (args) => (args as unknown[])[0] as string,
    );
    expect(calls.some((sql) => /ON DELETE RESTRICT/i.test(sql))).toBe(true);
  });

  it('createTable emits CREATE TABLE with status CHECK constraint', async () => {
    await service.createTable();

    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(/CREATE TABLE IF NOT EXISTS org_vector_db/i),
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

  it('runs migration 003 on a fresh database', async () => {
    await service.runTrackedMigrations();

    expect(db.recordMigration).toHaveBeenCalledWith(
      'vector_db_003_create_ingestion_job',
    );
  });

  it('skips 003 when it has already run', async () => {
    db.hasMigrationRun.mockImplementation(
      async (name) => name === 'vector_db_003_create_ingestion_job',
    );
    await service.runTrackedMigrations();

    expect(db.recordMigration).not.toHaveBeenCalledWith(
      'vector_db_003_create_ingestion_job',
    );
  });

  it('createIngestionJobTable creates table with status CHECK constraint', async () => {
    await service.createIngestionJobTable();

    const calls = (db.query as jest.Mock).mock.calls.map(
      (args) => (args as unknown[])[0] as string,
    );
    expect(
      calls.some((sql) => /CREATE TABLE IF NOT EXISTS vector_db_ingestion_job/i.test(sql)),
    ).toBe(true);
    expect(
      calls.some((sql) =>
        /status IN \('pending','processing','done','failed'\)/.test(sql),
      ),
    ).toBe(true);
  });

  it('createIngestionJobTable creates both claim and vector_db indexes', async () => {
    await service.createIngestionJobTable();

    const calls = (db.query as jest.Mock).mock.calls.map(
      (args) => (args as unknown[])[0] as string,
    );
    expect(calls.some((sql) => /idx_vdb_job_claim/.test(sql))).toBe(true);
    expect(calls.some((sql) => /idx_vdb_job_vector_db/.test(sql))).toBe(true);
  });
});
