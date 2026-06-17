import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../../shared/infrastructure/database/database.module';
import type {
  ProjectDataSourceRow,
  ProjectRow,
} from '../../../api/dto/project.dto';
import type {
  CreateDataSourceRow,
  CreateProjectRow,
  IProjectsRepository,
  UpdateProjectRow,
} from '../../../domain/repositories/projects.repository.interface';

@Injectable()
export class ProjectsDatabaseRepository implements IProjectsRepository {
  constructor(private readonly db: DatabaseService) {}

  async listForOrganization(organizationId: string): Promise<ProjectRow[]> {
    return this.db.query<ProjectRow>(
      `SELECT id, organization_id, name, description, created_by_user_id,
              created_at, updated_at
         FROM project
        WHERE organization_id = $1
        ORDER BY created_at ASC`,
      [organizationId],
    );
  }

  async listAll(): Promise<ProjectRow[]> {
    return this.db.query<ProjectRow>(
      `SELECT id, organization_id, name, description, created_by_user_id,
              created_at, updated_at
         FROM project
        ORDER BY created_at ASC`,
    );
  }

  async findById(id: string): Promise<ProjectRow | null> {
    return this.db.queryOne<ProjectRow>(
      `SELECT id, organization_id, name, description, created_by_user_id,
              created_at, updated_at
         FROM project
        WHERE id = $1`,
      [id],
    );
  }

  async findByOrganizationAndName(
    organizationId: string,
    name: string,
  ): Promise<ProjectRow | null> {
    return this.db.queryOne<ProjectRow>(
      `SELECT id, organization_id, name, description, created_by_user_id,
              created_at, updated_at
         FROM project
        WHERE organization_id = $1 AND name = $2`,
      [organizationId, name],
    );
  }

  async create(params: CreateProjectRow): Promise<ProjectRow> {
    const rows = await this.db.query<ProjectRow>(
      `INSERT INTO project (id, organization_id, name, description, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, organization_id, name, description, created_by_user_id,
                 created_at, updated_at`,
      [
        params.id,
        params.organizationId,
        params.name,
        params.description,
        params.createdByUserId,
      ],
    );
    return rows[0];
  }

  async update(
    id: string,
    params: UpdateProjectRow,
  ): Promise<ProjectRow | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let position = 1;

    if (params.name !== undefined) {
      fields.push(`name = $${position++}`);
      values.push(params.name);
    }
    if (params.description !== undefined) {
      fields.push(`description = $${position++}`);
      values.push(params.description);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const rows = await this.db.query<ProjectRow>(
      `UPDATE project
          SET ${fields.join(', ')}
        WHERE id = $${position}
        RETURNING id, organization_id, name, description, created_by_user_id,
                  created_at, updated_at`,
      values,
    );
    return rows[0] ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      `DELETE FROM project WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows.length > 0;
  }

  async listSources(projectId: string): Promise<ProjectDataSourceRow[]> {
    return this.db.query<ProjectDataSourceRow>(
      `SELECT id, project_id, kind, name, config, status, status_detail,
              created_at, updated_at
         FROM project_data_source
        WHERE project_id = $1
        ORDER BY created_at ASC`,
      [projectId],
    );
  }

  async findSourceById(
    projectId: string,
    sourceId: string,
  ): Promise<ProjectDataSourceRow | null> {
    return this.db.queryOne<ProjectDataSourceRow>(
      `SELECT id, project_id, kind, name, config, status, status_detail,
              created_at, updated_at
         FROM project_data_source
        WHERE project_id = $1 AND id = $2`,
      [projectId, sourceId],
    );
  }

  async createSource(
    params: CreateDataSourceRow,
  ): Promise<ProjectDataSourceRow> {
    const name =
      params.input.kind === 'airweave_collection'
        ? (params.input.name ?? params.input.config.airweaveCollectionName)
        : params.input.name;

    const rows = await this.db.query<ProjectDataSourceRow>(
      `INSERT INTO project_data_source
         (id, project_id, kind, name, config, status, status_detail)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING id, project_id, kind, name, config, status, status_detail,
                 created_at, updated_at`,
      [
        params.id,
        params.projectId,
        params.input.kind,
        name,
        JSON.stringify(params.input.config),
        params.status ?? 'ready',
        params.statusDetail ?? null,
      ],
    );
    return rows[0];
  }

  async deleteSource(projectId: string, sourceId: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      `DELETE FROM project_data_source
        WHERE project_id = $1 AND id = $2
        RETURNING id`,
      [projectId, sourceId],
    );
    return rows.length > 0;
  }

  async countSources(projectId: string): Promise<number> {
    const row = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM project_data_source
        WHERE project_id = $1`,
      [projectId],
    );
    return Number(row?.count ?? 0);
  }

  async countConversations(projectId: string): Promise<number> {
    const row = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM conversation
        WHERE project_id = $1`,
      [projectId],
    );
    return Number(row?.count ?? 0);
  }

  async findProjectsReferencingAirweaveCollection(
    airweaveCollectionReadableId: string,
    organizationId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.db.query<{ id: string; name: string }>(
      `SELECT DISTINCT p.id, p.name
         FROM project p
         JOIN project_data_source pds ON pds.project_id = p.id
        WHERE pds.kind = 'airweave_collection'
          AND pds.config->>'airweaveCollectionReadableId' = $1
          AND p.organization_id = $2`,
      [airweaveCollectionReadableId, organizationId],
    );
  }

  // Raw SQL required: JSON operator on project_data_source.config (JSONB column).
  async findProjectsReferencingVectorDb(
    vectorDbId: string,
    organizationId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.db.query<{ id: string; name: string }>(
      `SELECT DISTINCT p.id, p.name
         FROM project p
         JOIN project_data_source pds ON pds.project_id = p.id
        WHERE pds.kind = 'vector_db'
          AND pds.config->>'vectorDbId' = $1
          AND p.organization_id = $2`,
      [vectorDbId, organizationId],
    );
  }
}
