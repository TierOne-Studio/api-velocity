import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { IProjectsRepository } from '../../projects/domain/repositories/projects.repository.interface';
import type { ProjectRow } from '../../projects/api/dto/project.dto';
import { EmbedSite } from '../domain/entities/embed-site';
import {
  EmbedSiteProjectConflictError,
  EmbedSitePublicKeyCollisionError,
  type EmbedSiteRepositoryPort,
} from '../domain/repositories/embed-site.repository.interface';
import { EmbedSitesService } from './embed-sites.service';

function makeSite(overrides: Partial<EmbedSite> = {}): EmbedSite {
  return {
    id: 'site-1',
    organizationId: 'org-1',
    projectId: 'proj-1',
    name: 'Widget',
    publicKey: 'wgt_pub_generated',
    allowedOrigins: ['https://customer.com'],
    enabled: true,
    theme: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const adminScope = {
  userId: 'u1',
  platformRole: 'admin' as const,
  activeOrganizationId: 'org-1',
};

describe('EmbedSitesService', () => {
  let repo: jest.Mocked<EmbedSiteRepositoryPort>;
  let projects: jest.Mocked<IProjectsRepository>;
  let service: EmbedSitesService;

  beforeEach(() => {
    repo = {
      findByPublicKey: jest.fn(),
      incrementMonthlyUsage: jest.fn(),
      findById: jest.fn(),
      listByOrg: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      rotateKey: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<EmbedSiteRepositoryPort>;
    projects = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<IProjectsRepository>;
    service = new EmbedSitesService(repo, projects);
  });

  describe('create', () => {
    const input = {
      name: 'Widget',
      projectId: 'proj-1',
      allowedOrigins: ['https://customer.com'],
    };

    it('creates a site for a project owned by the caller org, with a generated key', async () => {
      projects.findById.mockResolvedValue({
        id: 'proj-1',
        organization_id: 'org-1',
      } as ProjectRow);
      repo.create.mockResolvedValue(makeSite());

      const result = await service.create(adminScope, input);

      expect(result.publicKey).toBe('wgt_pub_generated');
      // organizationId comes from the resolved scope, NOT the input.
      const createArg = repo.create.mock.calls[0][0];
      expect(createArg.organizationId).toBe('org-1');
      expect(createArg.publicKey).toMatch(/^wgt_pub_/);
      // Summary omits organizationId (§9.4).
      expect(result).not.toHaveProperty('organizationId');
    });

    it('returns 404 when the project belongs to ANOTHER org (cross-org attach blocked)', async () => {
      projects.findById.mockResolvedValue({
        id: 'proj-1',
        organization_id: 'org-2', // different org
      } as ProjectRow);

      await expect(service.create(adminScope, input)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('returns 404 when the project does not exist', async () => {
      projects.findById.mockResolvedValue(null);
      await expect(service.create(adminScope, input)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('checks project ownership BEFORE attempting the insert (no 409 oracle)', async () => {
      projects.findById.mockResolvedValue({
        id: 'proj-1',
        organization_id: 'org-2',
      } as ProjectRow);
      await expect(service.create(adminScope, input)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // Ownership 404 fires without ever hitting the unique-constraint path.
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('maps a project-conflict from the repo to 409', async () => {
      projects.findById.mockResolvedValue({
        id: 'proj-1',
        organization_id: 'org-1',
      } as ProjectRow);
      repo.create.mockRejectedValue(new EmbedSiteProjectConflictError('dup'));

      await expect(service.create(adminScope, input)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('regenerates the key and retries on a public-key collision', async () => {
      projects.findById.mockResolvedValue({
        id: 'proj-1',
        organization_id: 'org-1',
      } as ProjectRow);
      repo.create
        .mockRejectedValueOnce(new EmbedSitePublicKeyCollisionError('collide'))
        .mockResolvedValueOnce(makeSite());

      const result = await service.create(adminScope, input);

      expect(repo.create).toHaveBeenCalledTimes(2);
      const firstKey = repo.create.mock.calls[0][0].publicKey;
      const secondKey = repo.create.mock.calls[1][0].publicKey;
      expect(firstKey).not.toBe(secondKey); // a fresh key on retry
      expect(result.id).toBe('site-1');
    });

    it('fails fast after exhausting key-collision retries', async () => {
      projects.findById.mockResolvedValue({
        id: 'proj-1',
        organization_id: 'org-1',
      } as ProjectRow);
      repo.create.mockRejectedValue(
        new EmbedSitePublicKeyCollisionError('always collide'),
      );

      await expect(service.create(adminScope, input)).rejects.toThrow(
        /key generation failed after 3 attempts/,
      );
      expect(repo.create).toHaveBeenCalledTimes(3);
    });

    it('normalizes + dedupes allowedOrigins on write', async () => {
      projects.findById.mockResolvedValue({
        id: 'proj-1',
        organization_id: 'org-1',
      } as ProjectRow);
      repo.create.mockResolvedValue(makeSite());

      await service.create(adminScope, {
        ...input,
        allowedOrigins: ['https://Customer.com:443/', 'https://customer.com'],
      });

      expect(repo.create.mock.calls[0][0].allowedOrigins).toEqual([
        'https://customer.com',
      ]);
    });

    it('rejects an unparseable origin with 400', async () => {
      await expect(
        service.create(adminScope, { ...input, allowedOrigins: ['not-a-url'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(projects.findById).not.toHaveBeenCalled();
    });

    it('rejects a blank name with 400', async () => {
      await expect(
        service.create(adminScope, { ...input, name: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('org scoping (requireOrg)', () => {
    it('rejects a non-superadmin targeting another org with 403', async () => {
      await expect(
        service.list({ ...adminScope, organizationId: 'org-2' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('requires superadmin to name an organization explicitly', async () => {
      await expect(
        service.list({
          userId: 'su',
          platformRole: 'superadmin',
          activeOrganizationId: null,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lists within the active org', async () => {
      repo.listByOrg.mockResolvedValue([makeSite()]);
      const result = await service.list(adminScope);
      expect(repo.listByOrg).toHaveBeenCalledWith('org-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('not-found mapping (cross-org returns null → 404)', () => {
    it('getById → 404 when the repo returns null', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.getById(adminScope, 'x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('update → 404 when the repo returns null', async () => {
      repo.update.mockResolvedValue(null);
      await expect(
        service.update(adminScope, 'x', { name: 'new' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rotateKey → 404 when the repo returns null', async () => {
      repo.rotateKey.mockResolvedValue(null);
      await expect(service.rotateKey(adminScope, 'x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('delete → 404 when the repo reports no row removed', async () => {
      repo.delete.mockResolvedValue(false);
      await expect(service.delete(adminScope, 'x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('passes a normalized patch through to the repo', async () => {
      repo.update.mockResolvedValue(makeSite({ enabled: false }));
      await service.update(adminScope, 'site-1', {
        enabled: false,
        allowedOrigins: ['HTTPS://Example.COM'],
      });
      expect(repo.update).toHaveBeenCalledWith('site-1', 'org-1', {
        enabled: false,
        allowedOrigins: ['https://example.com'],
      });
    });
  });
});
