export { ProjectsModule } from './projects.module';
export { ProjectsService } from './application/services/projects.service';
export { ProjectsMigrationService } from './projects.migration';
export { DataSourceRegistry } from './application/providers/data-source.registry';
export { PROJECTS_REPOSITORY } from './domain/repositories/projects.repository.interface';
export type {
  IProjectsRepository,
  CreateProjectRow,
  CreateDataSourceRow,
  UpdateProjectRow,
} from './domain/repositories/projects.repository.interface';
export { getAllowedAirweaveCollectionIds } from './application/services/projects.service';
export type {
  ProjectSummary,
  ProjectDetail,
  ProjectDataSource,
  DataSourceKind,
  DataSourceStatus,
  CreateProjectInput,
  CreateDataSourceInput,
  UpdateProjectInput,
  ProjectRow,
  ProjectDataSourceRow,
} from './api/dto/project.dto';
export type {
  DataSourceProvider,
  DataSourceSearchOptions,
  AgentToolContext,
  AgentToolEvent,
  AgentToolPersistedCall,
  SqlProgressCallback,
} from './application/providers/data-source-provider.interface';
