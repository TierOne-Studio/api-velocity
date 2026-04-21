import { jest } from '@jest/globals';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => {},
  AllowAnonymous: () => () => {},
  BetterAuthGuard: class {},
  BetterAuthModule: { forRoot: jest.fn(() => ({ module: class {} })) },
}));

import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PermissionsGuard } from '../../../../shared';
import { ProjectsService } from '../../application/services/projects.service';
import { ProjectsController } from './projects.controller';

const adminSession = {
  user: { id: 'user-1', role: 'admin' },
  session: { activeOrganizationId: 'org-1' },
} as never;

const superadminSession = {
  user: { id: 'user-super', role: 'superadmin' },
  session: { activeOrganizationId: null },
} as never;

const sessionWithoutOrg = {
  user: { id: 'user-2', role: 'admin' },
  session: { activeOrganizationId: null },
} as never;

describe('ProjectsController', () => {
  let controller: ProjectsController;
  let projectsService: jest.Mocked<ProjectsService>;

  beforeEach(() => {
    projectsService = {
      listForScope: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      addSource: jest.fn(),
      removeSource: jest.fn(),
    } as unknown as jest.Mocked<ProjectsService>;

    controller = new ProjectsController(projectsService);
  });

  it('applies class-level PermissionsGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ProjectsController,
    ) as unknown[];

    expect(guards).toContain(PermissionsGuard);
  });

  it('rejects non-superadmin requests without an active organization', async () => {
    await expect(controller.list(sessionWithoutOrg)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('forwards list calls with the caller scope', async () => {
    projectsService.listForScope.mockResolvedValue([]);

    await controller.list(adminSession, 'org-override');

    expect(projectsService.listForScope).toHaveBeenCalledWith({
      userId: 'user-1',
      platformRole: 'admin',
      activeOrganizationId: 'org-1',
      organizationId: 'org-override',
    });
  });

  it('allows superadmin list without an active organization', async () => {
    projectsService.listForScope.mockResolvedValue([]);

    await controller.list(superadminSession);

    expect(projectsService.listForScope).toHaveBeenCalledWith(
      expect.objectContaining({
        platformRole: 'superadmin',
        activeOrganizationId: null,
      }),
    );
  });

  it('forwards scope=all for superadmin as scopeMode:all', async () => {
    projectsService.listForScope.mockResolvedValue([]);

    await controller.list(superadminSession, undefined, 'all');

    expect(projectsService.listForScope).toHaveBeenCalledWith(
      expect.objectContaining({
        platformRole: 'superadmin',
        scopeMode: 'all',
      }),
    );
  });

  it('rejects scope=all for non-superadmin with BadRequest', async () => {
    await expect(
      controller.list(adminSession, undefined, 'all'),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('rejects create calls without a name or organizationId', async () => {
    await expect(
      controller.create(adminSession, { name: 'x' } as never),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });

    await expect(
      controller.create(adminSession, { organizationId: 'org-1' } as never),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('forwards create calls with a scoped organizationId', async () => {
    projectsService.create.mockResolvedValue({} as never);

    await controller.create(adminSession, {
      organizationId: 'org-1',
      name: 'Sales',
    });

    expect(projectsService.create).toHaveBeenCalledWith(
      { organizationId: 'org-1', name: 'Sales' },
      expect.objectContaining({ organizationId: 'org-1' }),
    );
  });

  it('rejects addSource calls without a kind', async () => {
    await expect(
      controller.addSource(adminSession, 'project-1', {} as never),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('forwards addSource calls to the service', async () => {
    projectsService.addSource.mockResolvedValue({} as never);

    await controller.addSource(adminSession, 'project-1', {
      kind: 'airweave_collection',
      config: {
        collectionReadableId: 'coll-1',
        collectionName: 'Docs',
      },
    });

    expect(projectsService.addSource).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({ kind: 'airweave_collection' }),
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('forwards removeSource calls to the service', async () => {
    projectsService.removeSource.mockResolvedValue({ deleted: true });

    const result = await controller.removeSource(
      adminSession,
      'project-1',
      'source-1',
    );

    expect(projectsService.removeSource).toHaveBeenCalledWith(
      'project-1',
      'source-1',
      expect.objectContaining({ userId: 'user-1' }),
    );
    expect(result).toEqual({ deleted: true });
  });
});
