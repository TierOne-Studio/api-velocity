export const INGESTION_QUEUE = 'INGESTION_QUEUE';

/** A job delivered to a worker — only the payload is exposed to the domain. */
export interface QueuedJob<T> {
  data: T;
}

export interface EnqueueOptions {
  /** Max reschedules the queue performs on a thrown handler. MUST be >= the
   * handler's own MAX attempts so the queue keeps rescheduling until the
   * handler reaches its terminal decision (ADR-014 §5). */
  retryLimit?: number;
  retryBackoff?: boolean;
}

/**
 * Port for the durable job queue (pg-boss today). Lives in `domain/` so the
 * application layer depends on this abstraction, not the queue SDK (ADR-009).
 */
export interface IIngestionQueue {
  start(): Promise<void>;
  stop(graceful: boolean): Promise<void>;
  ensureQueue(name: string): Promise<void>;
  work<T>(
    name: string,
    handler: (jobs: QueuedJob<T>[]) => Promise<void>,
  ): Promise<void>;
  send<T>(name: string, data: T, options?: EnqueueOptions): Promise<void>;
}
