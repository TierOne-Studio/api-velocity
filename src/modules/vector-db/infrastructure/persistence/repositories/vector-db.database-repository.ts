import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../../../../shared/infrastructure/database/database.module';
import type { VectorDbRow } from '../../../api/dto/vector-db.dto';
import type {
  CreateVectorDbRow,
  CreateIngestionJobRow,
  IngestionJobRow,
  IngestionJobStatus,
  IVectorDbRepository,
  VectorDbStatus,
  UpdateVectorDbRow,
} from '../../../domain/vector-db.repository';

// Source states from which each target status is reachable — the inverse of the
// ADR-013 Decision 10 transition table, with the same state included so an
// idempotent re-write (the reconcile sweep may re-run an in-flight job) is a
// legal no-op. Used as an atomic guard in the UPDATE's WHERE clause so the
// transition check and the write commit together (no read-then-write race).
const STATUS_REACHABLE_FROM: Record<VectorDbStatus, VectorDbStatus[]> = {
  empty: ['empty', 'ready'],
  processing: ['processing', 'empty', 'ready', 'error'],
  ready: ['ready', 'processing'],
  error: ['error', 'processing'],
};

const INGESTION_JOB_COLUMNS = `
  id, vector_db_id, s3_key, original_filename,
  file_size_bytes, content_type, status, attempts,
  locked_until, last_error, created_at, updated_at
`;

const SELECT_COLUMNS = `
  id, organization_id, name, description,
  vector_store_kind, vector_store_ref,
  status, status_error, document_count,
  version, processing_started_at, last_ingested_at,
  created_at, updated_at
`;

@Injectable()
export class VectorDbDatabaseRepository implements IVectorDbRepository {
  constructor(private readonly db: DatabaseService) {}

  async assertOrganizationExists(orgId: string): Promise<void> {
    const row = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM organization WHERE id = $1`,
      [orgId],
    );
    if (!row) throw new NotFoundException(`Organization not found`);
  }

  async create(row: CreateVectorDbRow): Promise<VectorDbRow> {
    const inserted = await this.db.queryOne<VectorDbRow>(
      `INSERT INTO org_vector_db (
         id, organization_id, name, description,
         vector_store_kind, vector_store_ref,
         status, status_error, document_count
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'empty', NULL, 0)
       RETURNING ${SELECT_COLUMNS}`,
      [
        row.id,
        row.organizationId,
        row.name,
        row.description ?? null,
        row.vectorStoreKind,
        row.vectorStoreRef,
      ],
    );
    if (!inserted) throw new Error('Failed to insert vector database');
    return inserted;
  }

  async update(id: string, row: UpdateVectorDbRow): Promise<VectorDbRow> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    const append = (column: string, value: unknown) => {
      sets.push(`${column} = $${idx}`);
      values.push(value);
      idx++;
    };
    if (row.name !== undefined) append('name', row.name);
    if (row.description !== undefined) append('description', row.description);
    sets.push(`updated_at = now()`);
    sets.push(`version = version + 1`);

    values.push(id);
    const updated = await this.db.queryOne<VectorDbRow>(
      `UPDATE org_vector_db SET ${sets.join(', ')}
       WHERE id = $${idx} AND deleted_at IS NULL
       RETURNING ${SELECT_COLUMNS}`,
      values,
    );
    if (!updated) throw new Error('Vector database not found');
    return updated;
  }

  async updateStatus(
    id: string,
    status: VectorDbStatus,
    statusError: { message: string } | null,
  ): Promise<void> {
    // Atomic guarded transition: the WHERE clause enforces the legal source
    // states so the check and the write commit together (no read-then-write
    // race under concurrent workers). processing_started_at is stamped on
    // entry to processing — feeds the stuck-job reconcile sweep (ADR-014 §4).
    const updated = await this.db.queryOne<{ id: string }>(
      `UPDATE org_vector_db
         SET status = $1,
             status_error = $2,
             processing_started_at = CASE WHEN $1 = 'processing'
               THEN now() ELSE processing_started_at END
         WHERE id = $3 AND deleted_at IS NULL AND status = ANY($4)
         RETURNING id`,
      [status, statusError, id, STATUS_REACHABLE_FROM[status]],
    );
    if (updated) return;

    // No row changed: distinguish "not found" from "illegal transition".
    const current = await this.findById(id);
    if (!current) throw new NotFoundException('Vector database not found');
    throw new ConflictException(
      `Illegal vector-db status transition: ${current.status} -> ${status}`,
    );
  }

  async setVectorDbReadyIfIdle(vectorDbId: string): Promise<void> {
    // Concurrency-safe ready: only from processing, and only when no sibling
    // job is still active (ADR-014 §7). No-op otherwise (no throw).
    await this.db.query(
      `UPDATE org_vector_db
         SET status = 'ready', last_ingested_at = now()
         WHERE id = $1 AND deleted_at IS NULL AND status = 'processing'
           AND NOT EXISTS (
             SELECT 1 FROM vector_db_ingestion_job
              WHERE vector_db_id = $1 AND status IN ('pending', 'processing')
           )`,
      [vectorDbId],
    );
  }

  async incrementDocumentCount(id: string, delta: number): Promise<void> {
    await this.db.query(
      `UPDATE org_vector_db
         SET document_count = document_count + $1, last_ingested_at = now()
         WHERE id = $2 AND deleted_at IS NULL`,
      [delta, id],
    );
  }

  // NOT org-scoped by design: callers MUST pass a vectorDbId already authorized
  // for the org (e.g. via findByIdInOrg on a request path, or the org-bound job
  // row in the background worker). Do NOT call this directly from an HTTP path
  // with a user-supplied id — use findByIdInOrg for org-scoped access.
  async findById(id: string): Promise<VectorDbRow | null> {
    return this.db.queryOne<VectorDbRow>(
      `SELECT ${SELECT_COLUMNS} FROM org_vector_db
         WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
  }

  async findByIdInOrg(
    id: string,
    organizationId: string,
  ): Promise<VectorDbRow | null> {
    return this.db.queryOne<VectorDbRow>(
      `SELECT ${SELECT_COLUMNS} FROM org_vector_db
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [id, organizationId],
    );
  }

  async findManyByIdsForOrg(
    ids: string[],
    organizationId: string,
  ): Promise<VectorDbRow[]> {
    if (ids.length === 0) return [];
    return this.db.query<VectorDbRow>(
      `SELECT ${SELECT_COLUMNS} FROM org_vector_db
         WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
      [organizationId, ids],
    );
  }

  async listForOrganization(organizationId: string): Promise<VectorDbRow[]> {
    return this.db.query<VectorDbRow>(
      `SELECT ${SELECT_COLUMNS} FROM org_vector_db
         WHERE organization_id = $1 AND deleted_at IS NULL
         ORDER BY name ASC`,
      [organizationId],
    );
  }

  async findByOrganizationAndName(
    organizationId: string,
    name: string,
  ): Promise<VectorDbRow | null> {
    return this.db.queryOne<VectorDbRow>(
      `SELECT ${SELECT_COLUMNS} FROM org_vector_db
         WHERE organization_id = $1 AND name = $2 AND deleted_at IS NULL`,
      [organizationId, name],
    );
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.db.queryOne<{ id: string }>(
      `UPDATE org_vector_db
         SET deleted_at = now()
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
         RETURNING id`,
      [id, organizationId],
    );
    return Boolean(result);
  }

  async createIngestionJob(
    row: CreateIngestionJobRow,
  ): Promise<IngestionJobRow> {
    const inserted = await this.db.queryOne<IngestionJobRow>(
      `INSERT INTO vector_db_ingestion_job (
         vector_db_id, s3_key, original_filename, file_size_bytes, content_type
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING
         id, vector_db_id, s3_key, original_filename,
         file_size_bytes, content_type, status, attempts,
         locked_until, last_error, created_at, updated_at`,
      [
        row.vectorDbId,
        row.s3Key,
        row.originalFilename,
        row.fileSizeBytes,
        row.contentType,
      ],
    );
    if (!inserted) throw new Error('Failed to create ingestion job');
    return inserted;
  }

  async listJobsForVectorDb(vectorDbId: string): Promise<IngestionJobRow[]> {
    return this.db.query<IngestionJobRow>(
      `SELECT id, vector_db_id, s3_key, original_filename,
              file_size_bytes, content_type, status, attempts,
              locked_until, last_error, created_at, updated_at
         FROM vector_db_ingestion_job
        WHERE vector_db_id = $1
        ORDER BY created_at DESC`,
      [vectorDbId],
    );
  }

  async findIngestionJobById(
    jobId: string,
    vectorDbId: string,
  ): Promise<IngestionJobRow | null> {
    return this.db.queryOne<IngestionJobRow>(
      `SELECT id, vector_db_id, s3_key, original_filename,
              file_size_bytes, content_type, status, attempts,
              locked_until, last_error, created_at, updated_at
         FROM vector_db_ingestion_job
        WHERE id = $1 AND vector_db_id = $2`,
      [jobId, vectorDbId],
    );
  }

  async deleteIngestionJob(
    jobId: string,
    vectorDbId: string,
  ): Promise<boolean> {
    const result = await this.db.queryOne<{ id: string }>(
      `DELETE FROM vector_db_ingestion_job
        WHERE id = $1 AND vector_db_id = $2
        RETURNING id`,
      [jobId, vectorDbId],
    );
    return Boolean(result);
  }

  async setJobStatus(
    jobId: string,
    status: IngestionJobStatus,
    lastError: string | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE vector_db_ingestion_job
         SET status = $1, last_error = $2, updated_at = now()
         WHERE id = $3`,
      [status, lastError, jobId],
    );
  }

  async incrementJobAttempts(jobId: string): Promise<void> {
    await this.db.query(
      `UPDATE vector_db_ingestion_job
         SET attempts = attempts + 1, updated_at = now()
         WHERE id = $1`,
      [jobId],
    );
  }

  async findReclaimableJobs(stuckBefore: Date): Promise<IngestionJobRow[]> {
    return this.db.query<IngestionJobRow>(
      `SELECT ${INGESTION_JOB_COLUMNS}
         FROM vector_db_ingestion_job
        WHERE status = 'pending'
           OR (status = 'processing' AND updated_at < $1)`,
      [stuckBefore],
    );
  }

  async decrementDocumentCount(id: string, delta: number): Promise<void> {
    await this.db.query(
      `UPDATE org_vector_db
         SET document_count = GREATEST(document_count - $1, 0)
         WHERE id = $2 AND deleted_at IS NULL`,
      [delta, id],
    );
  }
}
