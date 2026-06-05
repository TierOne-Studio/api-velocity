import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  VECTOR_DB_REPOSITORY,
  type IVectorDbRepository,
} from '../../domain/vector-db.repository';
import {
  VECTOR_STORE,
  type IVectorStore,
} from '../../domain/vector-store.port';
import { EMBEDDER, type IEmbedder } from '../../domain/embedder.port';
import {
  VECTOR_DB_FILE_UPLOADER,
  type IVectorDbFileUploader,
} from '../../domain/vector-db-file-uploader.port';
import {
  INGESTION_QUEUE,
  type IIngestionQueue,
  type QueuedJob,
} from '../../domain/ingestion-queue.port';
import { TEXT_CHUNKER, type ITextChunker } from '../../domain/text-chunker.port';
import { deterministicPointId } from '../../domain/point-id';

export const VECTOR_DB_INGESTION_QUEUE = 'vector-db-ingestion';

/** Max processing attempts before a job is marked permanently failed (ADR-014 §5). */
export const MAX_INGESTION_ATTEMPTS = 3;

/** A processing job untouched for this long is considered crashed and reclaimed (ADR-014 §4). */
const STUCK_THRESHOLD_MS = 10 * 60 * 1000;

export interface IngestionJobPayload {
  jobId: string;
  vectorDbId: string;
}

/**
 * Owns the ingestion pipeline (ADR-014): pg-boss queue lifecycle, the startup
 * reconcile sweep, and the per-job worker (read S3 → chunk → embed → upsert →
 * status transitions). All external systems are reached via domain ports
 * (ADR-009); this service never imports an SDK directly.
 */
@Injectable()
export class VectorDbIngestionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(VectorDbIngestionService.name);

  constructor(
    @Inject(INGESTION_QUEUE) private readonly queue: IIngestionQueue,
    @Inject(VECTOR_DB_REPOSITORY)
    private readonly repository: IVectorDbRepository,
    @Inject(VECTOR_STORE) private readonly vectorStore: IVectorStore,
    @Inject(EMBEDDER) private readonly embedder: IEmbedder,
    @Inject(VECTOR_DB_FILE_UPLOADER)
    private readonly files: IVectorDbFileUploader,
    @Inject(TEXT_CHUNKER) private readonly chunker: ITextChunker,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.start();
    await this.queue.ensureQueue(VECTOR_DB_INGESTION_QUEUE);
    await this.queue.work<IngestionJobPayload>(
      VECTOR_DB_INGESTION_QUEUE,
      (jobs) => this.handleBatch(jobs),
    );
    await this.reconcile();
  }

  async onModuleDestroy(): Promise<void> {
    // Graceful: in-flight jobs finish or release their lease (ADR-014 §4).
    await this.queue.stop(true);
  }

  /** Best-effort enqueue at upload time; the reconcile sweep is the durability
   * guarantee if this is lost (ADR-014 §4 — the job row is the SoT).
   *
   * `retryLimit` is derived from `MAX_INGESTION_ATTEMPTS` so the queue keeps
   * rescheduling a thrown (non-terminal) job until the handler reaches its own
   * terminal decision (ADR-014 §5). The two MUST stay coupled: if the queue
   * limit were smaller than the handler's, the queue would stop rescheduling
   * before the handler marks the job failed, stranding it until the next
   * reconcile sweep. */
  async enqueue(jobId: string, vectorDbId: string): Promise<void> {
    await this.queue.send(
      VECTOR_DB_INGESTION_QUEUE,
      { jobId, vectorDbId },
      { retryLimit: MAX_INGESTION_ATTEMPTS, retryBackoff: true },
    );
  }

  /**
   * Re-enqueue lost (`pending`) and crashed (`stale processing`) jobs at boot.
   * Idempotent upserts make re-processing safe.
   */
  async reconcile(): Promise<void> {
    const stuckBefore = new Date(Date.now() - STUCK_THRESHOLD_MS);
    const jobs = await this.repository.findReclaimableJobs(stuckBefore);
    for (const job of jobs) {
      await this.enqueue(job.id, job.vector_db_id);
    }
    if (jobs.length > 0) {
      this.logger.log('reconcile re-enqueued ingestion jobs', {
        count: jobs.length,
      });
    }
  }

  private async handleBatch(
    jobs: QueuedJob<IngestionJobPayload>[],
  ): Promise<void> {
    for (const job of jobs) {
      await this.ingest(job.data);
    }
  }

  /**
   * Process one ingestion job. Public so the worker behavior is unit-testable
   * through real code paths (ports mocked at the boundary). Throws to let
   * pg-boss reschedule a non-terminal failure; returns on success or terminal
   * failure so pg-boss marks the job complete (ADR-014 §5).
   */
  async ingest(payload: IngestionJobPayload): Promise<void> {
    const { jobId, vectorDbId } = payload;

    const jobRow = await this.repository.findIngestionJobById(jobId, vectorDbId);
    if (!jobRow) {
      this.logger.warn('ingestion job row not found; skipping', {
        jobId,
        vectorDbId,
      });
      return;
    }
    if (jobRow.status === 'done') return; // idempotent: already ingested

    const vdb = await this.repository.findById(vectorDbId);
    if (!vdb) {
      await this.repository.setJobStatus(jobId, 'failed', 'vector db not found');
      this.logger.warn('vector db not found for ingestion job; failing', {
        jobId,
        vectorDbId,
      });
      return;
    }

    try {
      await this.repository.setJobStatus(jobId, 'processing', null);
      await this.repository.updateStatus(vectorDbId, 'processing', null);

      const { body } = await this.files.get(jobRow.s3_key);
      const chunks = await this.chunker.chunk(body.toString('utf-8'));

      if (chunks.length > 0) {
        const vectors = await this.embedder.embed(chunks);
        await this.vectorStore.ensureCollection(
          vdb.vector_store_ref,
          this.embedder.dimensions(),
        );
        const points = chunks.map((text, index) => ({
          id: deterministicPointId(vectorDbId, jobRow.s3_key, index),
          vector: vectors[index],
          payload: { vectorDbId, s3Key: jobRow.s3_key, chunkIndex: index, text },
        }));
        await this.vectorStore.upsert(vdb.vector_store_ref, points);
      }

      await this.repository.setJobStatus(jobId, 'done', null);
      await this.repository.setVectorDbReadyIfIdle(vectorDbId);
      this.logger.log('ingestion job completed', {
        jobId,
        vectorDbId,
        chunks: chunks.length,
      });
    } catch (error) {
      const terminal = await this.handleFailure(jobRow.id, vectorDbId, jobRow.attempts, error);
      if (!terminal) throw error; // let pg-boss reschedule with backoff
    }
  }

  /** Returns true when the failure is terminal (do not rethrow). */
  private async handleFailure(
    jobId: string,
    vectorDbId: string,
    priorAttempts: number,
    error: unknown,
  ): Promise<boolean> {
    const message = error instanceof Error ? error.message : String(error);
    await this.repository.incrementJobAttempts(jobId);

    if (priorAttempts + 1 >= MAX_INGESTION_ATTEMPTS) {
      await this.repository.setJobStatus(jobId, 'failed', message);
      await this.repository.updateStatus(vectorDbId, 'error', { message });
      this.logger.error('ingestion job failed permanently', {
        jobId,
        vectorDbId,
        attempts: priorAttempts + 1,
      });
      return true;
    }

    await this.repository.setJobStatus(jobId, 'pending', message);
    this.logger.warn('ingestion job failed; will retry', {
      jobId,
      vectorDbId,
      attempts: priorAttempts + 1,
    });
    return false;
  }
}
