import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { AirweaveService } from '../../../airweave/application/services/airweave.service';
import { AdminOrganizationsService } from '../../../admin/organizations/application/services/admin-organizations.service';
import type {
  CreateDataSourceInput,
  CreateProjectInput,
  ProjectDataSource,
  ProjectDataSourceRow,
  ProjectDetail,
  ProjectRow,
  ProjectSummary,
  UpdateProjectInput,
} from '../../api/dto/project.dto';
import {
  PROJECTS_REPOSITORY,
  type IProjectsRepository,
} from '../../domain/repositories/projects.repository.interface';
import type { PlatformRole } from '../../../admin/users/utils/admin.utils';

type CallerScope = {
  userId: string;
  platformRole: PlatformRole;
  activeOrganizationId: string | null;
  organizationId?: string;
  scopeMode?: 'all';
};

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PROJECTS_REPOSITORY)
    private readonly repository: IProjectsRepository,
    private readonly airweaveService: AirweaveService,
    private readonly adminOrganizationsService: AdminOrganizationsService,
  ) {}

  async listForScope(scope: CallerScope): Promise<ProjectSummary[]> {
    // Explicit cross-org view via ?scope=all — only for superadmin (controller validates).
    if (scope.scopeMode === 'all' && scope.platformRole === 'superadmin') {
      const rows = await this.repository.listAll();
      return Promise.all(rows.map((row) => this.toSummary(row)));
    }

    const organizationId = this.resolveScopeOrganization(scope);
    const rows =
      scope.platformRole === 'superadmin' && !organizationId
        ? await this.repository.listAll()
        : await this.repository.listForOrganization(organizationId);
    return Promise.all(rows.map((row) => this.toSummary(row)));
  }

  async getById(id: string, scope: CallerScope): Promise<ProjectDetail> {
    const row = await this.requireOwnedProject(id, scope);
    const sources = await this.repository.listSources(row.id);
    const summary = await this.toSummary(row);
    return {
      ...summary,
      sources: sources.map((source) => this.toSource(source)),
    };
  }

  async create(
    input: CreateProjectInput,
    scope: CallerScope,
  ): Promise<ProjectDetail> {
    const name = input.name?.trim();
    if (!name) {
      throw new BadRequestException('Project name is required');
    }

    const organizationId = input.organizationId?.trim();
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }

    this.ensureOrgAccess(scope, organizationId);

    const existing = await this.repository.findByOrganizationAndName(
      organizationId,
      name,
    );
    if (existing) {
      throw new ConflictException(
        `A project named "${name}" already exists in this organization`,
      );
    }

    const project = await this.repository.create({
      id: randomUUID(),
      organizationId,
      name,
      description: input.description?.trim() || null,
      createdByUserId: scope.userId,
    });

    const sources: ProjectDataSourceRow[] = [];
    for (const sourceInput of input.initialSources ?? []) {
      const created = await this.attachSource(
        project.id,
        organizationId,
        sourceInput,
        scope.platformRole,
      );
      sources.push(created);
    }

    const summary = await this.toSummary(project);
    return {
      ...summary,
      sources: sources.map((source) => this.toSource(source)),
    };
  }

  async update(
    id: string,
    input: UpdateProjectInput,
    scope: CallerScope,
  ): Promise<ProjectDetail> {
    const project = await this.requireOwnedProject(id, scope);
    const trimmedName = input.name?.trim();

    if (trimmedName === '') {
      throw new BadRequestException('Project name cannot be empty');
    }

    if (trimmedName && trimmedName !== project.name) {
      const duplicate = await this.repository.findByOrganizationAndName(
        project.organization_id,
        trimmedName,
      );
      if (duplicate && duplicate.id !== project.id) {
        throw new ConflictException(
          `A project named "${trimmedName}" already exists in this organization`,
        );
      }
    }

    const updated = await this.repository.update(project.id, {
      name: trimmedName ?? undefined,
      description:
        input.description === undefined
          ? undefined
          : input.description?.trim() || null,
    });

    const sources = await this.repository.listSources(project.id);
    const summary = await this.toSummary(updated ?? project);
    return {
      ...summary,
      sources: sources.map((source) => this.toSource(source)),
    };
  }

  async delete(id: string, scope: CallerScope): Promise<{ deleted: boolean }> {
    const project = await this.requireOwnedProject(id, scope);
    const deleted = await this.repository.delete(project.id);
    return { deleted };
  }

  async addSource(
    projectId: string,
    input: CreateDataSourceInput,
    scope: CallerScope,
  ): Promise<ProjectDataSource> {
    const project = await this.requireOwnedProject(projectId, scope);
    const source = await this.attachSource(
      project.id,
      project.organization_id,
      input,
      scope.platformRole,
    );
    return this.toSource(source);
  }

  async removeSource(
    projectId: string,
    sourceId: string,
    scope: CallerScope,
  ): Promise<{ deleted: boolean }> {
    const project = await this.requireOwnedProject(projectId, scope);
    const deleted = await this.repository.deleteSource(project.id, sourceId);
    if (!deleted) {
      throw new NotFoundException('Data source not found');
    }
    return { deleted };
  }

  async resolveProjectSources(
    projectId: string,
    organizationId: string | null,
  ): Promise<{
    project: ProjectRow;
    sources: ProjectDataSource[];
  }> {
    const project = await this.repository.findById(projectId);
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    if (organizationId && project.organization_id !== organizationId) {
      throw new ForbiddenException(
        'Project does not belong to this organization',
      );
    }
    const sourceRows = await this.repository.listSources(project.id);
    return {
      project,
      sources: sourceRows.map((row) => this.toSource(row)),
    };
  }

  private async attachSource(
    projectId: string,
    organizationId: string,
    input: CreateDataSourceInput,
    platformRole: PlatformRole,
  ): Promise<ProjectDataSourceRow> {
    if (input.kind === 'database' || input.kind === 'external') {
      throw new NotImplementedException(
        `Data source kind "${input.kind}" is not yet supported`,
      );
    }

    if (input.kind === 'airweave_collection') {
      const collectionId = input.config.collectionReadableId?.trim();
      if (!collectionId) {
        throw new BadRequestException('collectionReadableId is required');
      }

      await this.validateAirweaveAccess(
        organizationId,
        collectionId,
        platformRole,
      );

      const collection = await this.airweaveService.getCollection(collectionId);

      return this.repository.createSource({
        id: randomUUID(),
        projectId,
        input: {
          kind: 'airweave_collection',
          name: input.name?.trim() || collection.name,
          config: {
            collectionReadableId: collection.readableId,
            collectionName: collection.name,
          },
        },
      });
    }

    throw new BadRequestException('Unsupported data source kind');
  }

  private async validateAirweaveAccess(
    organizationId: string,
    collectionReadableId: string,
    platformRole: PlatformRole,
  ): Promise<void> {
    if (platformRole === 'superadmin') return;

    const organization =
      await this.adminOrganizationsService.findById(organizationId);
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const allowed = getAllowedAirweaveCollectionIds(organization.metadata);

    if (!allowed.includes(collectionReadableId)) {
      throw new ForbiddenException(
        'This collection is not allowed for this organization',
      );
    }
  }

  private async toSummary(row: ProjectRow): Promise<ProjectSummary> {
    const [sourceCount, conversationCount] = await Promise.all([
      this.repository.countSources(row.id),
      this.repository.countConversations(row.id),
    ]);

    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      description: row.description,
      createdByUserId: row.created_by_user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sourceCount,
      conversationCount,
    };
  }

  private toSource(row: ProjectDataSourceRow): ProjectDataSource {
    const base = {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      status: row.status,
      statusDetail: row.status_detail,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } as const;

    if (row.kind === 'airweave_collection') {
      return {
        ...base,
        kind: 'airweave_collection',
        config: row.config as ProjectDataSource extends {
          kind: 'airweave_collection';
          config: infer C;
        }
          ? C
          : never,
      };
    }

    if (row.kind === 'database') {
      return {
        ...base,
        kind: 'database',
        config: row.config,
      };
    }

    return {
      ...base,
      kind: 'external',
      config: row.config,
    };
  }

  private async requireOwnedProject(
    id: string,
    scope: CallerScope,
  ): Promise<ProjectRow> {
    const project = await this.repository.findById(id);
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (scope.platformRole === 'superadmin') return project;

    const orgId = this.resolveScopeOrganization(scope);
    if (!orgId || project.organization_id !== orgId) {
      throw new ForbiddenException(
        'Project does not belong to this organization',
      );
    }
    return project;
  }

  private ensureOrgAccess(scope: CallerScope, organizationId: string) {
    if (scope.platformRole === 'superadmin') return;
    const effective = scope.organizationId ?? scope.activeOrganizationId;
    if (!effective || effective !== organizationId) {
      throw new ForbiddenException(
        'You can only manage projects in your active organization',
      );
    }
  }

  private resolveScopeOrganization(scope: CallerScope): string | null {
    if (scope.platformRole === 'superadmin') {
      return scope.organizationId ?? scope.activeOrganizationId ?? null;
    }
    return scope.organizationId ?? scope.activeOrganizationId;
  }
}

export function getAllowedAirweaveCollectionIds(
  metadata: Record<string, unknown> | null | undefined,
): string[] {
  if (!metadata) return [];
  const raw = metadata['allowedAirweaveCollectionIds'];
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === 'string');
}
