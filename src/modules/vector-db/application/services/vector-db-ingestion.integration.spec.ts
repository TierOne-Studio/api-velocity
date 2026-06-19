// End-to-end integration spec for the ingestion pipeline — runs against REAL
// Postgres + pg-boss + Qdrant + OpenAI + S3 (NOT mocks). This is the binding
// acceptance layer for Slice 4 (coordination plan §11 / ADR-014).
//
// SETUP CONTRACT (loaded via dotenv when ConfigService is imported):
// - DATABASE_URL, QDRANT_URL, QDRANT_API_KEY, OPENAI_API_KEY, S3_BUCKET (+ AWS
//   creds) must all be set. If any is missing, every test here is SKIPPED so
//   unit-only CI stays green.
// - Fixtures use unique ids and are cleaned up (Qdrant collection, S3 object,
//   job rows, vdb, org) in afterEach/afterAll.

import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QdrantClient } from '@qdrant/js-client-rest';
import { ConfigService } from '../../../../shared/config/config.service';
import { VectorDbDatabaseRepository } from '../../infrastructure/persistence/repositories/vector-db.database-repository';
import { QdrantVectorStoreAdapter } from '../../infrastructure/qdrant/qdrant-vector-store.adapter';
import { OpenAiEmbedderAdapter } from '../../infrastructure/openai/openai-embedder.adapter';
import { VectorDbFileUploaderService } from '../../infrastructure/s3/vector-db-file-uploader.service';
import { PgBossIngestionQueueAdapter } from '../../infrastructure/queue/pg-boss-ingestion-queue.adapter';
import { RecursiveTextChunker } from '../../infrastructure/textsplitter/recursive-text-chunker.adapter';
import { DocumentExtractorAdapter } from '../../infrastructure/extractor/document-extractor.adapter';
import { NoopDocumentImageExtractorAdapter } from '../../infrastructure/extractor/noop-document-image-extractor.adapter';
import { NoopImageDescriberAdapter } from '../../infrastructure/anthropic/noop-image-describer.adapter';
import { VectorDbService } from './vector-db.service';
import {
  VectorDbIngestionService,
  VECTOR_DB_INGESTION_QUEUE,
  type IngestionJobPayload,
} from './vector-db-ingestion.service';
import type { DatabaseService } from '../../../../shared/infrastructure/database/database.module';

const haveAll =
  process.env.DATABASE_URL &&
  process.env.QDRANT_URL &&
  process.env.QDRANT_API_KEY &&
  process.env.OPENAI_API_KEY &&
  process.env.S3_BUCKET;
const describeIfLive = haveAll ? describe : describe.skip;

function makeDb(pool: Pool): DatabaseService {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      return (await pool.query(sql, params)).rows as T[];
    },
    async queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
      return ((await pool.query(sql, params)).rows[0] as T | undefined) ?? null;
    },
    async transaction<T>(fn: (db: DatabaseService) => Promise<T>): Promise<T> {
      return fn(makeDb(pool));
    },
  } as unknown as DatabaseService;
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 20_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('waitFor timed out');
}

describeIfLive('Vector DB ingestion pipeline (live integration)', () => {
  let pool: Pool;
  let raw: QdrantClient;
  let config: ConfigService;
  let repository: VectorDbDatabaseRepository;
  let files: VectorDbFileUploaderService;
  let queue: PgBossIngestionQueueAdapter;
  let service: VectorDbIngestionService;
  let vectorDbService: VectorDbService;

  let orgId: string;
  let vdbId: string;
  let ref: string;
  let s3Key: string;

  beforeAll(async () => {
    config = new ConfigService();
    pool = new Pool({ connectionString: config.getDatabaseUrl() });
    raw = new QdrantClient({
      url: config.getQdrantUrl(),
      apiKey: config.getQdrantApiKey(),
    });
    repository = new VectorDbDatabaseRepository(makeDb(pool));
    files = new VectorDbFileUploaderService(config);
    queue = new PgBossIngestionQueueAdapter(config);
    service = new VectorDbIngestionService(
      queue,
      repository,
      new QdrantVectorStoreAdapter(config),
      new OpenAiEmbedderAdapter(config),
      files,
      new RecursiveTextChunker(),
      new DocumentExtractorAdapter(),
      new NoopDocumentImageExtractorAdapter(),
      new NoopImageDescriberAdapter(),
      config,
    );
    vectorDbService = new VectorDbService(repository, files, service);
    await queue.start();
    await queue.ensureQueue(VECTOR_DB_INGESTION_QUEUE);
  }, 60_000);

  afterAll(async () => {
    if (queue) await queue.stop(false);
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    const suffix = randomBytes(4).toString('hex');
    orgId = `e2e-ingest-${suffix}`;
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt", metadata)
       VALUES ($1, $2, $3, NOW(), NULL)`,
      [orgId, `E2E Ingest ${suffix}`, orgId],
    );
    const vdb = await repository.create({
      id: randomUUID(),
      organizationId: orgId,
      name: `kb-${suffix}`,
      description: null,
      vectorStoreKind: 'qdrant',
      vectorStoreRef: `vdb_test_${suffix}`,
    });
    vdbId = vdb.id;
    ref = vdb.vector_store_ref;
    s3Key = `vector-dbs/${orgId}/${vdbId}/${randomUUID()}`;
  }, 30_000);

  afterEach(async () => {
    await raw.deleteCollection(ref).catch(() => undefined);
    await files.delete(s3Key).catch(() => undefined);
    await pool.query(
      `DELETE FROM vector_db_ingestion_job WHERE vector_db_id = $1`,
      [vdbId],
    );
    await pool.query(`DELETE FROM org_vector_db WHERE id = $1`, [vdbId]);
    await pool.query(`DELETE FROM organization WHERE id = $1`, [orgId]);
  }, 30_000);

  async function seedFileAndJob(text: string): Promise<string> {
    await files.put(s3Key, Buffer.from(text, 'utf-8'), 'text/plain', 'doc.txt');
    const job = await repository.createIngestionJob({
      vectorDbId: vdbId,
      s3Key,
      originalFilename: 'doc.txt',
      fileSizeBytes: Buffer.byteLength(text),
      contentType: 'text/plain',
    });
    return job.id;
  }

  async function seedBinaryFixtureAndJob(
    fixtureName: string,
    contentType: string,
  ): Promise<string> {
    const body = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../infrastructure/extractor/__fixtures__',
        fixtureName,
      ),
    );
    await files.put(s3Key, body, contentType, fixtureName);
    const job = await repository.createIngestionJob({
      vectorDbId: vdbId,
      s3Key,
      originalFilename: fixtureName,
      fileSizeBytes: body.length,
      contentType,
    });
    return job.id;
  }

  it('ingests an uploaded file: KB -> ready and vectors land in Qdrant', async () => {
    const jobId = await seedFileAndJob(
      'Velocity is a platform for building knowledge bases. ' +
        'It supports retrieval-augmented generation over uploaded documents.',
    );

    await service.ingest({ jobId, vectorDbId: vdbId } as IngestionJobPayload);

    const vdb = await repository.findById(vdbId);
    expect(vdb?.status).toBe('ready');

    const { count } = await raw.count(ref, { exact: true });
    expect(count).toBeGreaterThan(0);

    const job = await repository.findIngestionJobById(jobId, vdbId);
    expect(job?.status).toBe('done');
  }, 60_000);

  it('ingests a real PDF end-to-end: the EXTRACTED text (not raw bytes) lands as searchable vectors in Qdrant', async () => {
    // The fixture is FlateDecode-compressed, so the marker is absent from the
    // raw bytes — it can only reach Qdrant if real PDF extraction ran. Reverting
    // to `body.toString('utf-8')` would store mojibake and fail the scroll assert.
    const jobId = await seedBinaryFixtureAndJob(
      'sample.pdf',
      'application/pdf',
    );

    await service.ingest({ jobId, vectorDbId: vdbId } as IngestionJobPayload);

    expect((await repository.findById(vdbId))?.status).toBe('ready');
    expect((await raw.count(ref, { exact: true })).count).toBeGreaterThan(0);

    const scrolled = await raw.scroll(ref, { with_payload: true, limit: 50 });
    const chunkTexts = scrolled.points.map(
      (p) => (p.payload?.text as string) ?? '',
    );
    expect(
      chunkTexts.some((t) => t.includes('Velocity ingestion smoke test')),
    ).toBe(true);

    expect((await repository.findIngestionJobById(jobId, vdbId))?.status).toBe(
      'done',
    );
  }, 60_000);

  it('fails a scanned/image-only PDF terminally with KB error (does not land "ready" empty)', async () => {
    const jobId = await seedBinaryFixtureAndJob('empty.pdf', 'application/pdf');

    await service.ingest({ jobId, vectorDbId: vdbId } as IngestionJobPayload);

    expect((await repository.findById(vdbId))?.status).toBe('error');
    const job = await repository.findIngestionJobById(jobId, vdbId);
    expect(job?.status).toBe('failed');
    // Terminal in one attempt — non-retryable, retry budget untouched.
    expect(job?.attempts).toBe(0);
  }, 60_000);

  it('drives document_count through the real upload entry point, then ingests to ready', async () => {
    // §11: "upload -> ... -> ready, document_count > 0" asserted through the
    // actual uploadFile entry point (not a mid-pipeline seed).
    const file = {
      buffer: Buffer.from('A document uploaded through the real entry point.'),
      originalname: 'upload.txt',
      mimetype: 'text/plain',
      size: 48,
    } as unknown as Express.Multer.File;
    const scope = {
      userId: 'u-e2e',
      platformRole: 'member' as const,
      activeOrganizationId: orgId,
    };

    const job = await vectorDbService.uploadFile(scope, vdbId, file);

    const afterUpload = await repository.findById(vdbId);
    expect(afterUpload?.document_count).toBe(1);

    // Capture the s3 key the service generated so afterEach cleans it up.
    const jobRow = await repository.findIngestionJobById(job.id, vdbId);
    s3Key = jobRow.s3_key;

    await service.ingest({
      jobId: job.id,
      vectorDbId: vdbId,
    } as IngestionJobPayload);
    const ready = await repository.findById(vdbId);
    expect(ready?.status).toBe('ready');
  }, 60_000);

  it('is idempotent: re-ingesting the same job does not duplicate vectors', async () => {
    const jobId = await seedFileAndJob(
      'A document about idempotent vector ingestion.',
    );

    await service.ingest({ jobId, vectorDbId: vdbId } as IngestionJobPayload);
    const first = await raw.count(ref, { exact: true });

    await repository.setJobStatus(jobId, 'pending', null);
    await service.ingest({ jobId, vectorDbId: vdbId } as IngestionJobPayload);
    const second = await raw.count(ref, { exact: true });

    expect(second.count).toBe(first.count);
  }, 60_000);

  it('surfaces an error (KB -> error) when the S3 object is missing after MAX attempts', async () => {
    const job = await repository.createIngestionJob({
      vectorDbId: vdbId,
      s3Key: `vector-dbs/${orgId}/${vdbId}/${randomUUID()}`,
      originalFilename: 'missing.txt',
      fileSizeBytes: 1,
      contentType: 'text/plain',
    });
    await repository.incrementJobAttempts(job.id);
    await repository.incrementJobAttempts(job.id); // attempts now 2 (MAX-1)

    await service.ingest({
      jobId: job.id,
      vectorDbId: vdbId,
    } as IngestionJobPayload);

    const vdb = await repository.findById(vdbId);
    expect(vdb?.status).toBe('error');
    expect(vdb?.status_error?.message).toBeTruthy();
    const failed = await repository.findIngestionJobById(job.id, vdbId);
    expect(failed?.status).toBe('failed');
  }, 60_000);

  it('pg-boss round-trip: an enqueued job is delivered to a worker', async () => {
    const q = `vidx_rt_${randomBytes(4).toString('hex')}`;
    await queue.ensureQueue(q);

    const delivered = new Promise<IngestionJobPayload>((resolve) => {
      void queue.work<IngestionJobPayload>(q, async (jobs) => {
        resolve(jobs[0].data);
      });
    });
    await queue.send(q, { jobId: 'rt-1', vectorDbId: 'kb-rt' });

    const received = await Promise.race([
      delivered,
      new Promise<null>((r) => setTimeout(() => r(null), 15_000)),
    ]);
    expect(received).toEqual({ jobId: 'rt-1', vectorDbId: 'kb-rt' });
  }, 30_000);

  // Worker-registering test runs LAST so the shared-queue worker does not
  // consume other tests' fixtures.
  it('crash recovery: reconcile re-enqueues a stale job and a worker completes it', async () => {
    const jobId = await seedFileAndJob(
      'Crash recovery content processed by reconcile sweep.',
    );

    // Simulate a worker that died mid-flight: job stuck in processing, backdated.
    await repository.setJobStatus(jobId, 'processing', null);
    await pool.query(
      `UPDATE vector_db_ingestion_job SET updated_at = now() - interval '1 hour' WHERE id = $1`,
      [jobId],
    );

    // Register the real worker on the ingestion queue, then run the boot-time
    // reconcile sweep: it re-enqueues the stale job and the worker finishes it.
    await queue.work<IngestionJobPayload>(VECTOR_DB_INGESTION_QUEUE, (jobs) =>
      Promise.all(jobs.map((j) => service.ingest(j.data))).then(
        () => undefined,
      ),
    );
    await service.reconcile();

    await waitFor(async () => {
      const job = await repository.findIngestionJobById(jobId, vdbId);
      return job?.status === 'done';
    });

    const vdb = await repository.findById(vdbId);
    expect(vdb?.status).toBe('ready');
  }, 60_000);
});
