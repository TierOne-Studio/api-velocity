export type DataSourceKind = 'airweave_collection' | 'database' | 'external';

export type DataSourceStatus = 'ready' | 'connecting' | 'error';

export type AirweaveCollectionSourceConfig = {
  collectionReadableId: string;
  collectionName: string;
};

export type DatabaseSourceConfig = {
  connectionId: string;
  connectionName: string;
};

export type ExternalSourceConfig = Record<string, unknown>;

export type ProjectDataSource =
  | {
      id: string;
      projectId: string;
      kind: 'airweave_collection';
      name: string;
      config: AirweaveCollectionSourceConfig;
      status: DataSourceStatus;
      statusDetail: string | null;
      createdAt: string;
      updatedAt: string;
    }
  | {
      id: string;
      projectId: string;
      kind: 'database';
      name: string;
      config: DatabaseSourceConfig;
      status: DataSourceStatus;
      statusDetail: string | null;
      createdAt: string;
      updatedAt: string;
    }
  | {
      id: string;
      projectId: string;
      kind: 'external';
      name: string;
      config: ExternalSourceConfig;
      status: DataSourceStatus;
      statusDetail: string | null;
      createdAt: string;
      updatedAt: string;
    };

export type ProjectSummary = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  sourceCount: number;
  conversationCount: number;
};

export type ProjectDetail = ProjectSummary & {
  sources: ProjectDataSource[];
};

export type CreateAirweaveSourceInput = {
  kind: 'airweave_collection';
  name?: string;
  config: AirweaveCollectionSourceConfig;
};

export type CreateDatabaseSourceInput = {
  kind: 'database';
  name?: string;
  /**
   * `connectionId` is the only field the external API (admin dialog / project
   * form) submits. `connectionName` is populated server-side after resolving
   * the org connection and is stored in `project_data_source.config` so the
   * chat agent can surface it without an extra read.
   */
  config: { connectionId: string; connectionName?: string };
};

export type CreateExternalSourceInput = {
  kind: 'external';
  name: string;
  config: ExternalSourceConfig;
};

export type CreateDataSourceInput =
  | CreateAirweaveSourceInput
  | CreateDatabaseSourceInput
  | CreateExternalSourceInput;

export type CreateProjectInput = {
  organizationId: string;
  name: string;
  description?: string | null;
  initialSources?: CreateDataSourceInput[];
};

export type UpdateProjectInput = {
  name?: string;
  description?: string | null;
};

export type ProjectRow = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

export type ProjectDataSourceRow = {
  id: string;
  project_id: string;
  kind: DataSourceKind;
  name: string;
  config: Record<string, unknown>;
  status: DataSourceStatus;
  status_detail: string | null;
  created_at: string;
  updated_at: string;
};
