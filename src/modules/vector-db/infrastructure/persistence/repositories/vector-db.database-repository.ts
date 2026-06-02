import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../../../shared/infrastructure/database/database.module';
import type { VectorDbRow } from '../../../api/dto/vector-db.dto';
import type {
  CreateVectorDbRow,
  IVectorDbRepository,
  VectorDbStatus,
  UpdateVectorDbRow,
} from '../../../domain/vector-db.repository';

const SELECT_COLUMNS = `
  id, organization_id, name, description,
  vector_store_kind, vector_store_ref,
  status, status_error, document_count,
  version, processing_started_at, last_ingested_at,
  created_at, updated_at
`;

@Injectable()
export class VectorDbDatabaseRepository
  implements IVectorDbRepository
{
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

  async update(
    id: string,
    row: UpdateVectorDbRow,
  ): Promise<VectorDbRow> {
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
    await this.db.query(
      `UPDATE org_vector_db
         SET status = $1, status_error = $2
         WHERE id = $3 AND deleted_at IS NULL`,
      [status, statusError, id],
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

  async listForOrganization(
    organizationId: string,
  ): Promise<VectorDbRow[]> {
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

  async countProjectReferences(vectorDbId: string): Promise<number> {
    // Raw SQL required: JSON operator on project_data_source.config (JSONB column).
    const row = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM project_data_source
         WHERE kind = 'vector-db'
           AND config->>'knowledgeBaseId' = $1`,
      [vectorDbId],
    );
    return row ? parseInt(row.count, 10) : 0;
  }
}
