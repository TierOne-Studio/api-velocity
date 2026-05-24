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
   * Find every project that references the given Airweave collection's
   * `readable_id` via a `project_data_source` row with
   * `kind = 'airweave_collection'`. Used by `AirweaveService.deleteCollection`
   * to produce a 409 Conflict response (per ADR-011 § failure mode #4)
   * when a collection is still in use by one or more projects.
   *
   * Returns the bare minimum needed for the 409 body — `{ id, name }`. No
   * cross-org filter: collection ownership lives in the org allowlist (not
   * here), so this is purely a "what is using this id" query.
   */
  findProjectsReferencingAirweaveCollection(
    collectionReadableId: string,
  ): Promise<Array<{ id: string; name: string }>>;
}
