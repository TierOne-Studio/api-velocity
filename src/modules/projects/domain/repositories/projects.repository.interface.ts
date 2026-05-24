import type {
  CreateDataSourceInput,
  DataSourceStatus,
  ProjectDataSourceRow,
  ProjectRow,
} from '../../api/dto/project.dto';

export const PROJECTS_REPOSITORY = 'PROJECTS_REPOSITORY';

export type CreateProjectRow = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  createdByUserId: string;
};

export type UpdateProjectRow = {
  name?: string;
  description?: string | null;
};

export type CreateDataSourceRow = {
  id: string;
  projectId: string;
  input: CreateDataSourceInput;
  status?: DataSourceStatus;
  statusDetail?: string | null;
};

export interface IProjectsRepository {
  listForOrganization(organizationId: string): Promise<ProjectRow[]>;
  listAll(): Promise<ProjectRow[]>;
  findById(id: string): Promise<ProjectRow | null>;
  findByOrganizationAndName(
    organizationId: string,
    name: string,
  ): Promise<ProjectRow | null>;
  create(params: CreateProjectRow): Promise<ProjectRow>;
  update(id: string, params: UpdateProjectRow): Promise<ProjectRow | null>;
  delete(id: string): Promise<boolean>;
  listSources(projectId: string): Promise<ProjectDataSourceRow[]>;
  findSourceById(
    projectId: string,
    sourceId: string,
  ): Promise<ProjectDataSourceRow | null>;
  createSource(params: CreateDataSourceRow): Promise<ProjectDataSourceRow>;
  deleteSource(projectId: string, sourceId: string): Promise<boolean>;
  countSources(projectId: string): Promise<number>;
  countConversations(projectId: string): Promise<number>;

  /**
   * Find projects in the given organization that reference the given
   * Airweave collection's `readable_id` via a `project_data_source` row
   * with `kind = 'airweave_collection'`. Used by
   * `AirweaveService.deleteCollection` to produce a 409 Conflict response
   * (per ADR-011 § failure mode #4) when a collection is still in use.
   *
   * **Scoped to `organizationId`** per `repo-conventions` § 3 defense-in-
   * depth (security review H1, 2026-05-23): the 409 body surfaces project
   * `{id, name}` to the caller, so cross-org rows would be an information
   * leak even though the route already gates by ownership.
   */
  findProjectsReferencingAirweaveCollection(
    collectionReadableId: string,
    organizationId: string,
  ): Promise<Array<{ id: string; name: string }>>;
}
