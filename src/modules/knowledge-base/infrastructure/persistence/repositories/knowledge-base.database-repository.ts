import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../../shared/infrastructure/database/database.module';
import type { KnowledgeBaseRow } from '../../../api/dto/knowledge-base.dto';
import type {
  CreateKnowledgeBaseRow,
  IKnowledgeBaseRepository,
  KnowledgeBaseStatus,
  UpdateKnowledgeBaseRow,
} from '../../../domain/knowledge-base.repository';

const SELECT_COLUMNS = `
  id, organization_id, name, description, qdrant_collection,
  status, status_error, document_count, created_at, updated_at
`;

@Injectable()
export class KnowledgeBaseDatabaseRepository
  implements IKnowledgeBaseRepository
{
  constructor(private readonly db: DatabaseService) {}

  async create(row: CreateKnowledgeBaseRow): Promise<KnowledgeBaseRow> {
    const inserted = await this.db.queryOne<KnowledgeBaseRow>(
      `INSERT INTO org_knowledge_base (
         id, organization_id, name, description, qdrant_collection,
         status, status_error, document_count
       )
       VALUES ($1, $2, $3, $4, $5, 'empty', NULL, 0)
       RETURNING ${SELECT_COLUMNS}`,
      [
        row.id,
        row.organizationId,
        row.name,
        row.description ?? null,
        row.qdrantCollection,
      ],
    );
    if (!inserted) throw new Error('Failed to insert knowledge base');
    return inserted;
  }

  async update(
    id: string,
    row: UpdateKnowledgeBaseRow,
  ): Promise<KnowledgeBaseRow> {
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

    values.push(id);
    const updated = await this.db.queryOne<KnowledgeBaseRow>(
      `UPDATE org_knowledge_base SET ${sets.join(', ')}
       WHERE id = $${idx}
       RETURNING ${SELECT_COLUMNS}`,
      values,
    );
    if (!updated) throw new Error('Knowledge base not found');
    return updated;
  }

  async updateStatus(
    id: string,
    status: KnowledgeBaseStatus,
    statusError: string | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE org_knowledge_base
         SET status = $1, status_error = $2, updated_at = now()
         WHERE id = $3`,
      [status, statusError, id],
    );
  }

  async incrementDocumentCount(id: string, delta: number): Promise<void> {
    await this.db.query(
      `UPDATE org_knowledge_base
         SET document_count = document_count + $1, updated_at = now()
         WHERE id = $2`,
      [delta, id],
    );
  }

  async findById(id: string): Promise<KnowledgeBaseRow | null> {
    return this.db.queryOne<KnowledgeBaseRow>(
      `SELECT ${SELECT_COLUMNS} FROM org_knowledge_base WHERE id = $1`,
      [id],
    );
  }

  async findByIdInOrg(
    id: string,
    organizationId: string,
  ): Promise<KnowledgeBaseRow | null> {
    return this.db.queryOne<KnowledgeBaseRow>(
      `SELECT ${SELECT_COLUMNS} FROM org_knowledge_base
         WHERE id = $1 AND organization_id = $2`,
      [id, organizationId],
    );
  }

  async findManyByIdsForOrg(
    ids: string[],
    organizationId: string,
  ): Promise<KnowledgeBaseRow[]> {
    if (ids.length === 0) return [];
    return this.db.query<KnowledgeBaseRow>(
      `SELECT ${SELECT_COLUMNS} FROM org_knowledge_base
         WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
      [organizationId, ids],
    );
  }

  async listForOrganization(
    organizationId: string,
  ): Promise<KnowledgeBaseRow[]> {
    return this.db.query<KnowledgeBaseRow>(
      `SELECT ${SELECT_COLUMNS} FROM org_knowledge_base
         WHERE organization_id = $1
         ORDER BY name ASC`,
      [organizationId],
    );
  }

  async findByOrganizationAndName(
    organizationId: string,
    name: string,
  ): Promise<KnowledgeBaseRow | null> {
    return this.db.queryOne<KnowledgeBaseRow>(
      `SELECT ${SELECT_COLUMNS} FROM org_knowledge_base
         WHERE organization_id = $1 AND name = $2`,
      [organizationId, name],
    );
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.db.queryOne<{ id: string }>(
      `DELETE FROM org_knowledge_base
         WHERE id = $1 AND organization_id = $2
         RETURNING id`,
      [id, organizationId],
    );
    return Boolean(result);
  }

  async countProjectReferences(knowledgeBaseId: string): Promise<number> {
    const row = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM project_data_source
         WHERE kind = 'knowledge_base'
           AND config->>'knowledgeBaseId' = $1`,
      [knowledgeBaseId],
    );
    return row ? parseInt(row.count, 10) : 0;
  }
}
