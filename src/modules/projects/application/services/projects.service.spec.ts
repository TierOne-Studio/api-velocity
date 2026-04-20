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

    service = new ProjectsService(
      repository,
      airweaveService,
      adminOrganizationsService,
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
    it('rejects database sources as not yet supported', async () => {
      repository.findById.mockResolvedValue(orgProject);

      await expect(
        service.addSource(
          'project-1',
          {
            kind: 'database',
            name: 'Prod replica',
            config: { connectionRef: 'db-1' },
          },
          adminScope,
        ),
      ).rejects.toBeInstanceOf(NotImplementedException);
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
