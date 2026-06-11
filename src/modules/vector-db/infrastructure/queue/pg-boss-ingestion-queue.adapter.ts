import { Injectable } from '@nestjs/common';
import { PgBoss, type Job, type SendOptions } from 'pg-boss';
import { ConfigService } from '../../../../shared/config/config.service';
import type {
  EnqueueOptions,
  IIngestionQueue,
  QueuedJob,
} from '../../domain/ingestion-queue.port';

/** Concurrent jobs per node. Safe under multi-file ingest because the KB→ready
 * write is idle-guarded (ADR-014 §7). */
const WORKER_CONCURRENCY = 2;

/**
 * pg-boss adapter for {@link IIngestionQueue} (ADR-014 D1). The only place the
 * pg-boss SDK is imported (ADR-009). pg-boss runs its own `pgboss` schema
 * migrations on `start()`, independent of the repo's OnModuleInit migration
 * runner.
 */
@Injectable()
export class PgBossIngestionQueueAdapter implements IIngestionQueue {
  private readonly boss: PgBoss;

  constructor(config: ConfigService) {
    this.boss = new PgBoss(config.getDatabaseUrl());
  }

  async start(): Promise<void> {
    await this.boss.start();
  }

  async stop(graceful: boolean): Promise<void> {
    await this.boss.stop({ graceful });
  }

  async ensureQueue(name: string): Promise<void> {
    await this.boss.createQueue(name);
  }

  async work<T>(
    name: string,
    handler: (jobs: QueuedJob<T>[]) => Promise<void>,
  ): Promise<void> {
    await this.boss.work<T>(
      name,
      { batchSize: 1, localConcurrency: WORKER_CONCURRENCY },
      (jobs: Job<T>[]) => handler(jobs.map((job) => ({ data: job.data }))),
    );
  }

  async send<T>(
    name: string,
    data: T,
    options?: EnqueueOptions,
  ): Promise<void> {
    // pg-boss rejects `retryLimit: undefined`, so only set keys when provided.
    const sendOptions: SendOptions = {};
    if (options?.retryLimit !== undefined) {
      sendOptions.retryLimit = options.retryLimit;
    }
    if (options?.retryBackoff !== undefined) {
      sendOptions.retryBackoff = options.retryBackoff;
    }
    await this.boss.send(name, data as object, sendOptions);
  }
}
