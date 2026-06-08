import type { VectorDbRow } from '../api/dto/vector-db.dto';

export type VectorDbStatus = 'empty' | 'processing' | 'ready' | 'error';

export type IngestionJobStatus = 'pending' | 'processing' | 'done' | 'failed';

export type IngestionJobRow = {
  id: string;
  vector_db_id: string;
  s3_key: string;
  original_filename: string;
  file_size_bytes: string;
  content_type: string;
  status: IngestionJobStatus;
  attempts: number;
  locked_until: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateIngestionJobRow = {
  vectorDbId: string;
  s3Key: string;
  originalFilename: string;
  fileSizeBytes: number;
  contentType: string;
};

export const VECTOR_DB_REPOSITORY = 'VECTOR_DB_REPOSITORY';

export type CreateVectorDbRow = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  vectorStoreKind: string;
  vectorStoreRef: string;
};

export type UpdateVectorDbRow = {
  name?: string;
  description?: string | null;
};

export interface IVectorDbRepository {
  assertOrganizationExists(orgId: string): Promise<void>;
  create(row: CreateVectorDbRow): Promise<VectorDbRow>;
  update(id: string, row: UpdateVectorDbRow): Promise<VectorDbRow>;
  updateStatus(
    id: string,
    status: VectorDbStatus,
    statusError: { message: string } | null,
  ): Promise<void>;
  incrementDocumentCount(id: string, delta: number): Promise<void>;
  findById(id: string): Promise<VectorDbRow | null>;
  findByIdInOrg(
    id: string,
    organizationId: string,
  ): Promise<VectorDbRow | null>;
  findManyByIdsForOrg(
    ids: string[],
    organizationId: string,
  ): Promise<VectorDbRow[]>;
  listForOrganization(organizationId: string): Promise<VectorDbRow[]>;
  findByOrganizationAndName(
    organizationId: string,
    name: string,
  ): Promise<VectorDbRow | null>;
  delete(id: string, organizationId: string): Promise<boolean>;
  createIngestionJob(row: CreateIngestionJobRow): Promise<IngestionJobRow>;
  listJobsForVectorDb(vectorDbId: string): Promise<IngestionJobRow[]>;
  findIngestionJobById(jobId: string, vectorDbId: string): Promise<IngestionJobRow | null>;
  deleteIngestionJob(jobId: string, vectorDbId: string): Promise<boolean>;
  decrementDocumentCount(id: string, delta: number): Promise<void>;

  // Slice 4 — ingestion pipeline (ADR-014).
  /** Set the ingestion job's status + last_error (the UI source of truth). */
  setJobStatus(
    jobId: string,
    status: IngestionJobStatus,
    lastError: string | null,
  ): Promise<void>;
  /** Increment the job's attempt counter (drives the MAX_ATTEMPTS decision). */
  incrementJobAttempts(jobId: string): Promise<void>;
  /**
   * Promote the KB to `ready` only when no other active (pending/processing)
   * job remains for it — concurrency-safe under multi-file ingest (ADR-014 §7).
   * No-op otherwise.
   */
  setVectorDbReadyIfIdle(vectorDbId: string): Promise<void>;
  /**
   * Jobs the startup reconcile sweep should re-enqueue: every `pending` job
   * (lost-enqueue recovery) and every `processing` job whose `updated_at`
   * predates `stuckBefore` (crash recovery) — ADR-014 §4.
   */
  findReclaimableJobs(stuckBefore: Date): Promise<IngestionJobRow[]>;
}
