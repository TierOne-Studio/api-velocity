import { jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import {
  ProjectsService,
  getAllowedAirweaveCollectionIds,
} from './projects.service';
import type { IProjectsRepository } from '../../domain/repositories/projects.repository.interface';
import type { AirweaveService } from '../../../airweave/application/services/airweave.service';
import type { AdminOrganizationsService } from '../../../admin/organizations/application/services/admin-organizations.service';
import type { ProjectRow } from '../../api/dto/project.dto';

const now = '2026-04-17T00:00:00.000Z';

const orgProject: ProjectRow = {
  id: 'project-1',
  organization_id: 'org-1',
  name: 'General',
  description: null,
  created_by_user_id: 'user-1',
  created_at: now,
  updated_at: now,
};

const adminScope = {
  userId: 'user-1',
  platformRole: 'admin' as const,
  activeOrganizationId: 'org-1',
};

const superadminScope = {
  userId: 'user-super',
  platformRole: 'superadmin' as const,
  activeOrganizationId: null,
};

function buildRepositoryMock(): jest.Mocked<IProjectsRepository> {
  return {
    listForOrganization: jest.fn(),
    listAll: jest.fn(),
    findById: jest.fn(),
    findByOrganizationAndName: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    listSources: jest.fn(),
    findSourceById: jest.fn(),
    createSource: jest.fn(),
    deleteSource: jest.fn(),
    countSources: jest.fn(),
    countConversations: jest.fn(),
  } as unknown as jest.Mocked<IProjectsRepository>;
}

describe('ProjectsService', () => {
  let repository: jest.Mocked<IProjectsRepository>;
  let airweaveService: jest.Mocked<AirweaveService>;
  let adminOrganizationsService: jest.Mocked<AdminOrganizationsService>;
  let sqlConnectionsService: {
    findByIdForAttach: jest.MockedFunction<
      (
        orgId: string,
        id: string,
      ) => Promise<{
        id: string;
        organizationId: string;
        name: string;
        status: 'ready' | 'connecting' | 'error';
        statusError: string | null;
      } | null>
    >;
  };
  let vectorDbService: {
    findByIdForAttach: jest.MockedFunction<
      (
        orgId: string,
        id: string,
      ) => Promise<{
        id: string;
        organizationId: string;
        name: string;
        status: 'empty' | 'processing' | 'ready' | 'error';
        statusError: { message: string } | null;
      } | null>
    >;
  };
  let service: ProjectsService;

  beforeEach(() => {
    repository = buildRepositoryMock();
    repository.countSources.mockResolvedValue(0);
    repository.countConversations.mockResolvedValue(0);
    repository.listSources.mockResolvedValue([]);

    airweaveService = {
      getCollection: jest.fn(),
      searchCollection: jest.fn(),
    } as unknown as jest.Mocked<AirweaveService>;

    adminOrganizationsService = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<AdminOrganizationsService>;

    sqlConnectionsService = {
      findByIdForAttach:
        jest.fn() as (typeof sqlConnectionsService)['findByIdForAttach'],
    };

    vectorDbService = {
      findByIdForAttach:
        jest.fn() as (typeof vectorDbService)['findByIdForAttach'],
    };

    service = new ProjectsService(
      repository,
      airweaveService,
      adminOrganizationsService,
      sqlConnectionsService as never,
      vectorDbService as never,
    );
  });

  describe('listForScope', () => {
    it('returns projects for the caller active organization when not superadmin', async () => {
      repository.listForOrganization.mockResolvedValue([orgProject]);

      const result = await service.listForScope(adminScope);

      expect(repository.listForOrganization).toHaveBeenCalledWith('org-1');
      expect(repository.listAll).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'project-1',
        organizationId: 'org-1',
      });
    });

    it('returns all projects for superadmin without an active organization', async () => {
      repository.listAll.mockResolvedValue([orgProject]);

      await service.listForScope(superadminScope);

      expect(repository.listAll).toHaveBeenCalledTimes(1);
    });

    it('honors scopeMode=all for superadmin even when an active organization is set', async () => {
      repository.listAll.mockResolvedValue([orgProject]);

      await service.listForScope({
        ...superadminScope,
        activeOrganizationId: 'org-1',
        scopeMode: 'all',
      });

      expect(repository.listAll).toHaveBeenCalledTimes(1);
      expect(repository.listForOrganization).not.toHaveBeenCalled();
    });

    it('ignores scopeMode=all for non-superadmin (guarded by controller)', async () => {
      repository.listForOrganization.mockResolvedValue([orgProject]);

      await service.listForScope({
        ...adminScope,
        scopeMode: 'all',
      });

      expect(repository.listForOrganization).toHaveBeenCalledWith('org-1');
      expect(repository.listAll).not.toHaveBeenCalled();
    });

    it('allows non-superadmin to pass an organizationId that matches their active organization', async () => {
      repository.listForOrganization.mockResolvedValue([orgProject]);

      await service.listForScope({ ...adminScope, organizationId: 'org-1' });

      expect(repository.listForOrganization).toHaveBeenCalledWith('org-1');
    });

    it('rejects non-superadmin passing an organizationId different from their active organization', async () => {
      await expect(
        service.listForScope({ ...adminScope, organizationId: 'org-other' }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(repository.listForOrganization).not.toHaveBeenCalled();
      expect(repository.listAll).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('rejects empty names', async () => {
      await expect(
        service.create({ organizationId: 'org-1', name: '   ' }, adminScope),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects cross-organization creation for non-superadmin', async () => {
      await expect(
        service.create(
          { organizationId: 'org-other', name: 'Test' },
          adminScope,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects duplicate project names in the same organization', async () => {
      repository.findByOrganizationAndName.mockResolvedValue(orgProject);

      await expect(
        service.create(
          { organizationId: 'org-1', name: 'General' },
          adminScope,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates a project without initial sources', async () => {
      repository.findByOrganizationAndName.mockResolvedValue(null);
      repository.create.mockResolvedValue(orgProject);

      const result = await service.create(
        { organizationId: 'org-1', name: 'General' },
        adminScope,
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          name: 'General',
          createdByUserId: 'user-1',
        }),
      );
      expect(result.sources).toEqual([]);
    });

    it('attaches an airweave source during creation after allowlist check', async () => {
      repository.findByOrganizationAndName.mockResolvedValue(null);
      repository.create.mockResolvedValue(orgProject);
      adminOrganizationsService.findById.mockResolvedValue({
        id: 'org-1',
        metadata: { allowedAirweaveCollectionIds: ['coll-1'] },
      } as never);
      airweaveService.getCollection.mockResolvedValue({
        id: 'uuid-1',
        name: 'Docs',
        readableId: 'coll-1',
      } as never);
      repository.createSource.mockResolvedValue({
        id: 'source-1',
        project_id: 'project-1',
        kind: 'airweave_collection',
        name: 'Docs',
        config: { collectionReadableId: 'coll-1', collectionName: 'Docs' },
        status: 'ready',
        status_detail: null,
        created_at: now,
        updated_at: now,
      });

      const result = await service.create(
        {
          organizationId: 'org-1',
          name: 'General',
          initialSources: [
            {
              kind: 'airweave_collection',
              config: {
                collectionReadableId: 'coll-1',
                collectionName: 'Docs',
              },
            },
          ],
        },
        adminScope,
      );

      expect(adminOrganizationsService.findById).toHaveBeenCalledWith('org-1');
      expect(airweaveService.getCollection).toHaveBeenCalledWith('coll-1');
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].kind).toBe('airweave_collection');
    });

    it('rejects airweave sources outside the org allowlist', async () => {
      repository.findByOrganizationAndName.mockResolvedValue(null);
      repository.create.mockResolvedValue(orgProject);
      adminOrganizationsService.findById.mockResolvedValue({
        id: 'org-1',
        metadata: { allowedAirweaveCollectionIds: ['other-collection'] },
      } as never);

      await expect(
        service.create(
          {
            organizationId: 'org-1',
            name: 'General',
            initialSources: [
              {
                kind: 'airweave_collection',
                config: {
                  collectionReadableId: 'coll-blocked',
                  collectionName: 'Blocked',
                },
              },
            ],
          },
          adminScope,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(airweaveService.getCollection).not.toHaveBeenCalled();
    });

    it('bypasses allowlist for superadmin', async () => {
      repository.findByOrganizationAndName.mockResolvedValue(null);
      repository.create.mockResolvedValue(orgProject);
      airweaveService.getCollection.mockResolvedValue({
        id: 'uuid-1',
        name: 'Docs',
        readableId: 'coll-1',
      } as never);
      repository.createSource.mockResolvedValue({
        id: 'source-1',
        project_id: 'project-1',
        kind: 'airweave_collection',
        name: 'Docs',
        config: { collectionReadableId: 'coll-1', collectionName: 'Docs' },
        status: 'ready',
        status_detail: null,
        created_at: now,
        updated_at: now,
      });

      await service.create(
        {
          organizationId: 'org-1',
          name: 'General',
          initialSources: [
            {
              kind: 'airweave_collection',
              config: {
                collectionReadableId: 'coll-1',
                collectionName: 'Docs',
              },
            },
          ],
        },
        { ...superadminScope, organizationId: 'org-1' },
      );

      expect(adminOrganizationsService.findById).not.toHaveBeenCalled();
    });
  });

  describe('addSource', () => {
    it('attaches a database source by resolving the org SQL connection', async () => {
      repository.findById.mockResolvedValue(orgProject);
      const sqlConn = {
        id: 'db-1',
        organizationId: 'org-1',
        name: 'Prod replica',
        status: 'ready' as const,
        statusError: null,
      };
      sqlConnectionsService.findByIdForAttach.mockResolvedValue(sqlConn);
      const createdRow = {
        id: 'src-db-1',
        project_id: 'project-1',
        kind: 'database' as const,
        name: 'Prod replica',
        config: { connectionId: 'db-1', connectionName: 'Prod replica' },
        status: 'ready' as const,
        status_detail: null,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      };
      repository.createSource.mockResolvedValue(createdRow);

      const result = await service.addSource(
        'project-1',
        {
          kind: 'database',
          name: 'Prod replica',
          config: { connectionId: 'db-1' },
        },
        adminScope,
      );

      expect(result.kind).toBe('database');
      expect(result.config).toEqual({
        connectionId: 'db-1',
        connectionName: 'Prod replica',
      });
    });

    it('attaches a vector_db source by resolving the org vector database', async () => {
      repository.findById.mockResolvedValue(orgProject);
      vectorDbService.findByIdForAttach.mockResolvedValue({
        id: 'vdb-1',
        organizationId: 'org-1',
        name: 'Handbook',
        status: 'ready',
        statusError: null,
      });
      repository.createSource.mockResolvedValue({
        id: 'src-vdb-1',
        project_id: 'project-1',
        kind: 'vector_db',
        name: 'Handbook',
        config: { vectorDbId: 'vdb-1', vectorDbName: 'Handbook' },
        status: 'ready',
        status_detail: null,
        created_at: now,
        updated_at: now,
      });

      const result = await service.addSource(
        'project-1',
        { kind: 'vector_db', config: { vectorDbId: 'vdb-1' } },
        adminScope,
      );

      expect(result.kind).toBe('vector_db');
      expect(result.config).toEqual({
        vectorDbId: 'vdb-1',
        vectorDbName: 'Handbook',
      });
      expect(result.status).toBe('ready');
      expect(vectorDbService.findByIdForAttach).toHaveBeenCalledWith(
        'org-1',
        'vdb-1',
      );
    });

    it.each([
      ['ready', 'ready'],
      ['processing', 'connecting'],
      ['empty', 'connecting'],
      ['error', 'error'],
    ] as const)(
      'maps vector-db status %s to source status %s',
      async (vectorDbStatus, expectedStatus) => {
        repository.findById.mockResolvedValue(orgProject);
        vectorDbService.findByIdForAttach.mockResolvedValue({
          id: 'vdb-1',
          organizationId: 'org-1',
          name: 'Handbook',
          status: vectorDbStatus,
          statusError:
            vectorDbStatus === 'error' ? { message: 'ingest failed' } : null,
        });
        repository.createSource.mockImplementation((params) =>
          Promise.resolve({
            id: 'src-vdb-1',
            project_id: 'project-1',
            kind: 'vector_db',
            name: params.input.name ?? 'Handbook',
            config: { vectorDbId: 'vdb-1', vectorDbName: 'Handbook' },
            status: params.status ?? 'ready',
            status_detail: params.statusDetail ?? null,
            created_at: now,
            updated_at: now,
          }),
        );

        await service.addSource(
          'project-1',
          { kind: 'vector_db', config: { vectorDbId: 'vdb-1' } },
          adminScope,
        );

        expect(repository.createSource).toHaveBeenCalledWith(
          expect.objectContaining({ status: expectedStatus }),
        );
      },
    );

    it('throws NotFoundException when the vector database is not in the org', async () => {
      repository.findById.mockResolvedValue(orgProject);
      vectorDbService.findByIdForAttach.mockResolvedValue(null);

      await expect(
        service.addSource(
          'project-1',
          { kind: 'vector_db', config: { vectorDbId: 'missing' } },
          adminScope,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('requires a vectorDbId when adding a vector_db source', async () => {
      repository.findById.mockResolvedValue(orgProject);

      await expect(
        service.addSource(
          'project-1',
          { kind: 'vector_db', config: { vectorDbId: '   ' } },
          adminScope,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects external sources as not yet supported', async () => {
      repository.findById.mockResolvedValue(orgProject);

      await expect(
        service.addSource(
          'project-1',
          {
            kind: 'external',
            name: 'Ingest',
            config: { url: 'https://example.com' },
          },
          adminScope,
        ),
      ).rejects.toBeInstanceOf(NotImplementedException);
    });

    it('rejects projects that are not in the caller organization', async () => {
      repository.findById.mockResolvedValue({
        ...orgProject,
        organization_id: 'org-other',
      });

      await expect(
        service.addSource(
          'project-1',
          {
            kind: 'airweave_collection',
            config: {
              collectionReadableId: 'coll-1',
              collectionName: 'Docs',
            },
          },
          adminScope,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('requires a collection id when adding an airweave source', async () => {
      repository.findById.mockResolvedValue(orgProject);

      await expect(
        service.addSource(
          'project-1',
          {
            kind: 'airweave_collection',
            config: { collectionReadableId: '   ', collectionName: '' },
          },
          adminScope,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('removeSource', () => {
    it('throws when the source is missing', async () => {
      repository.findById.mockResolvedValue(orgProject);
      repository.deleteSource.mockResolvedValue(false);

      await expect(
        service.removeSource('project-1', 'source-missing', adminScope),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reports deleted when the source existed', async () => {
      repository.findById.mockResolvedValue(orgProject);
      repository.deleteSource.mockResolvedValue(true);

      const result = await service.removeSource(
        'project-1',
        'source-1',
        adminScope,
      );

      expect(result).toEqual({ deleted: true });
    });
  });

  describe('resolveProjectSources', () => {
    it('throws when the project does not belong to the requested organization', async () => {
      repository.findById.mockResolvedValue(orgProject);

      await expect(
        service.resolveProjectSources('project-1', 'org-other'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns sources for the matching organization', async () => {
      repository.findById.mockResolvedValue(orgProject);
      repository.listSources.mockResolvedValue([
        {
          id: 'source-1',
          project_id: 'project-1',
          kind: 'airweave_collection',
          name: 'Docs',
          config: { collectionReadableId: 'coll-1', collectionName: 'Docs' },
          status: 'ready',
          status_detail: null,
          created_at: now,
          updated_at: now,
        },
      ]);

      const result = await service.resolveProjectSources('project-1', 'org-1');

      expect(result.project.id).toBe('project-1');
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].kind).toBe('airweave_collection');
    });
  });

  describe('getAllowedAirweaveCollectionIds', () => {
    it('returns an empty list for null metadata', () => {
      expect(getAllowedAirweaveCollectionIds(null)).toEqual([]);
    });

    it('returns only string values', () => {
      expect(
        getAllowedAirweaveCollectionIds({
          allowedAirweaveCollectionIds: ['a', 42, null, 'b'],
        }),
      ).toEqual(['a', 'b']);
    });
  });
});
