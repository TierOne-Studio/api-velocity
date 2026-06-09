// Integration spec for the Slice-4 ingestion methods on
// VectorDbDatabaseRepository — runs every statement against the REAL Postgres
// test database (NOT mocks). Mirrors the repo convention established by
// admin-org.database-repository.allowlist.integration.spec.ts: mock-only
// `sql.toContain` assertions have shipped bugs past review; data-shaped SQL
// (status transitions, guarded updates) must be EXECUTED.
//
// SETUP CONTRACT:
// - DATABASE_URL must point at a Postgres test DB (loaded via dotenv when the
//   repository's DatabaseService import chain pulls in ConfigService). If
//   missing, every test here is SKIPPED so unit-only CI stays green.
// - The org_vector_db + vector_db_ingestion_job tables must exist (the module
//   migrations create them at boot). Fixtures use unique ids and are cleaned up
//   jobs -> vdb -> org (org FK is ON DELETE RESTRICT, ADR-013 D7).

import { ConflictException } from '@nestjs/common';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { VectorDbDatabaseRepository } from './vector-db.database-repository';
import type { DatabaseService } from '../../../../../shared/infrastructure/database/database.module';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

function makeDb(pool: Pool): DatabaseService {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = await pool.query(sql, params);
      return result.rows as T[];
    },
    async queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
      const result = await pool.query(sql, params);
      return (result.rows[0] as T | undefined) ?? null;
    },
  } as unknown as DatabaseService;
}

describeIfDb('VectorDbDatabaseRepository (ingestion) — real Postgres', () => {
  let pool: Pool;
  let repo: VectorDbDatabaseRepository;
  let orgId: string;
  let vdbId: string;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl });
    repo = new VectorDbDatabaseRepository(makeDb(pool));
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    const suffix = randomBytes(4).toString('hex');
    orgId = `e2e-vdb-${suffix}`;
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt", metadata)
       VALUES ($1, $2, $3, NOW(), NULL)`,
      [orgId, `E2E VDB ${suffix}`, orgId],
    );
    const vdb = await repo.create({
      id: randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12}).*/, '$1-$2-$3-$4-$5'),
      organizationId: orgId,
      name: `kb-${suffix}`,
      description: null,
      vectorStoreKind: 'qdrant',
      vectorStoreRef: `vdb_${suffix}`,
    });
    vdbId = vdb.id;
  });

  afterEach(async () => {
    await pool.query(
      `DELETE FROM vector_db_ingestion_job WHERE vector_db_id = $1`,
      [vdbId],
    );
    await pool.query(`DELETE FROM org_vector_db WHERE id = $1`, [vdbId]);
    await pool.query(`DELETE FROM organization WHERE id = $1`, [orgId]);
  });

  async function makeJob(status = 'pending'): Promise<string> {
    const job = await repo.createIngestionJob({
      vectorDbId: vdbId,
      s3Key: `vector-dbs/${orgId}/${vdbId}/${randomBytes(4).toString('hex')}`,
      originalFilename: 'doc.txt',
      fileSizeBytes: 10,
      contentType: 'text/plain',
    });
    if (status !== 'pending') {
      await repo.setJobStatus(job.id, status as never, null);
    }
    return job.id;
  }

  describe('setJobStatus', () => {
    it('updates the job status and last_error', async () => {
      const jobId = await makeJob();
      await repo.setJobStatus(jobId, 'failed', 'boom');

      const row = await repo.findIngestionJobById(jobId, vdbId);
      expect(row?.status).toBe('failed');
      expect(row?.last_error).toBe('boom');
    });

    it('clears last_error when passed null', async () => {
      const jobId = await makeJob();
      await repo.setJobStatus(jobId, 'failed', 'boom');
      await repo.setJobStatus(jobId, 'pending', null);

      const row = await repo.findIngestionJobById(jobId, vdbId);
      expect(row?.status).toBe('pending');
      expect(row?.last_error).toBeNull();
    });
  });

  describe('findDocumentNamesByS3Keys', () => {
    async function makeJobWith(s3Key: string, originalFilename: string) {
      await repo.createIngestionJob({
        vectorDbId: vdbId,
        s3Key,
        originalFilename,
        fileSizeBytes: 10,
        contentType: 'text/plain',
      });
    }

    it('maps known s3Keys to their original_filename and omits unknown keys', async () => {
      await makeJobWith('s3/a', 'alpha.pdf');
      await makeJobWith('s3/b', 'beta.docx');

      const rows = await repo.findDocumentNamesByS3Keys(vdbId, [
        's3/a',
        's3/b',
        's3/missing',
      ]);

      expect(new Map(rows.map((r) => [r.s3_key, r.original_filename]))).toEqual(
        new Map([
          ['s3/a', 'alpha.pdf'],
          ['s3/b', 'beta.docx'],
        ]),
      );
    });

    it('returns [] for an empty key list without touching the DB', async () => {
      expect(await repo.findDocumentNamesByS3Keys(vdbId, [])).toEqual([]);
    });

    it('does not resolve a key that belongs to another vector DB', async () => {
      const other = await repo.create({
        id: randomBytes(16)
          .toString('hex')
          .replace(/(.{8})(.{4})(.{4})(.{4})(.{12}).*/, '$1-$2-$3-$4-$5'),
        organizationId: orgId,
        name: `other-${randomBytes(4).toString('hex')}`,
        description: null,
        vectorStoreKind: 'qdrant',
        vectorStoreRef: `other_${randomBytes(4).toString('hex')}`,
      });
      try {
        await repo.createIngestionJob({
          vectorDbId: other.id,
          s3Key: 's3/shared',
          originalFilename: 'leak.pdf',
          fileSizeBytes: 10,
          contentType: 'text/plain',
        });

        const rows = await repo.findDocumentNamesByS3Keys(vdbId, ['s3/shared']);

        expect(rows).toEqual([]);
      } finally {
        await pool.query(
          `DELETE FROM vector_db_ingestion_job WHERE vector_db_id = $1`,
          [other.id],
        );
        await pool.query(`DELETE FROM org_vector_db WHERE id = $1`, [other.id]);
      }
    });
  });

  describe('incrementJobAttempts', () => {
    it('increments attempts by one each call', async () => {
      const jobId = await makeJob();
      await repo.incrementJobAttempts(jobId);
      await repo.incrementJobAttempts(jobId);

      const row = await repo.findIngestionJobById(jobId, vdbId);
      expect(row?.attempts).toBe(2);
    });
  });

  describe('updateStatus transition guard (ADR-013 Decision 10)', () => {
    it('allows empty -> processing and stamps processing_started_at', async () => {
      await repo.updateStatus(vdbId, 'processing', null);
      const row = await repo.findById(vdbId);
      expect(row?.status).toBe('processing');
      expect(row?.processing_started_at).not.toBeNull();
    });

    it('allows processing -> error and stores the message', async () => {
      await repo.updateStatus(vdbId, 'processing', null);
      await repo.updateStatus(vdbId, 'error', { message: 'ingest failed' });
      const row = await repo.findById(vdbId);
      expect(row?.status).toBe('error');
      expect(row?.status_error).toEqual({ message: 'ingest failed' });
    });

    it('rejects an illegal transition empty -> ready with ConflictException', async () => {
      await expect(repo.updateStatus(vdbId, 'ready', null)).rejects.toThrow(
        ConflictException,
      );
    });

    it('treats a same-state write as an idempotent no-op', async () => {
      await repo.updateStatus(vdbId, 'processing', null);
      await expect(
        repo.updateStatus(vdbId, 'processing', null),
      ).resolves.toBeUndefined();
    });
  });

  describe('setVectorDbReadyIfIdle (concurrency-safe ready)', () => {
    it('promotes processing -> ready when no active jobs remain', async () => {
      const jobId = await makeJob();
      await repo.updateStatus(vdbId, 'processing', null);
      await repo.setJobStatus(jobId, 'done', null);

      await repo.setVectorDbReadyIfIdle(vdbId);

      const row = await repo.findById(vdbId);
      expect(row?.status).toBe('ready');
    });

    it('stays processing while another job is still active', async () => {
      const doneJob = await makeJob();
      await makeJob('processing'); // sibling still in flight
      await repo.updateStatus(vdbId, 'processing', null);
      await repo.setJobStatus(doneJob, 'done', null);

      await repo.setVectorDbReadyIfIdle(vdbId);

      const row = await repo.findById(vdbId);
      expect(row?.status).toBe('processing');
    });
  });

  describe('findReclaimableJobs', () => {
    it('returns pending jobs and stale processing jobs, excluding fresh/terminal', async () => {
      const pendingJob = await makeJob('pending');
      const staleProcessing = await makeJob('processing');
      const freshProcessing = await makeJob('processing');
      await makeJob('done');
      await makeJob('failed');

      // Backdate the stale processing job's updated_at.
      await pool.query(
        `UPDATE vector_db_ingestion_job SET updated_at = now() - interval '1 hour' WHERE id = $1`,
        [staleProcessing],
      );

      const stuckBefore = new Date(Date.now() - 60_000); // 1 min ago
      const reclaimable = await repo.findReclaimableJobs(stuckBefore);
      const ids = reclaimable.map((j) => j.id);

      expect(ids).toContain(pendingJob);
      expect(ids).toContain(staleProcessing);
      expect(ids).not.toContain(freshProcessing);
    });
  });
});
