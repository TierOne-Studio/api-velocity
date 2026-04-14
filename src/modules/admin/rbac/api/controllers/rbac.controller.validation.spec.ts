import { jest } from '@jest/globals';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => {},
  AllowAnonymous: () => () => {},
  BetterAuthGuard: class {},
  BetterAuthModule: { forRoot: jest.fn(() => ({ module: class {} })) },
}));

import { HttpStatus } from '@nestjs/common';
import { RbacController } from './rbac.controller';
import { RoleService, PermissionService } from '../../application/services';

describe('RbacController validation', () => {
  let controller: RbacController;
  let roleService: jest.Mocked<RoleService>;

  beforeEach(() => {
    roleService = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findByName: jest.fn(),
      findByNameInOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      assignPermissions: jest.fn(),
      getPermissions: jest.fn(),
      getUserPermissions: jest.fn(),
      hasPermission: jest.fn(),
    } as unknown as jest.Mocked<RoleService>;

    const permissionService = {
      findAll: jest.fn(),
      findGroupedByResource: jest.fn(),
    } as unknown as PermissionService;

    controller = new RbacController(roleService, permissionService);
  });

  const session = {
    user: { role: 'manager' },
    session: { activeOrganizationId: 'org-1' },
  } as any;

  it('rejects createRole when name is missing', async () => {
    await expect(
      controller.createRole(
        session,
        { displayName: 'Editor' } as any,
        undefined,
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects createRole when displayName is missing', async () => {
    await expect(
      controller.createRole(session, { name: 'editor' } as any, undefined),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects createRole when name is the reserved global superadmin role', async () => {
    await expect(
      controller.createRole(
        session,
        { name: 'superadmin', displayName: 'Superadmin' } as any,
        undefined,
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('allows updateRole when only name is provided', async () => {
    roleService.update.mockResolvedValue({
      id: 'role-1',
      name: 'owner',
    } as any);

    await expect(
      controller.updateRole('role-1', { name: 'owner' }),
    ).resolves.toEqual({ data: { id: 'role-1', name: 'owner' } });
  });

  it('rejects updateRole when no updatable fields are provided', async () => {
    await expect(controller.updateRole('role-1', {})).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects assignPermissions when permissionIds is not an array', async () => {
    roleService.findById.mockResolvedValue({ id: 'role-1' } as any);

    await expect(
      controller.assignPermissions(session, 'role-1', {
        permissionIds: undefined as unknown as string[],
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('returns 404 on assignPermissions when role is not found', async () => {
    roleService.findById.mockResolvedValue(null);

    await expect(
      controller.assignPermissions(session, 'missing-role', { permissionIds: ['p1'] }),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('creates role when payload is valid', async () => {
    roleService.findByNameInOrganization.mockResolvedValue(null);
    roleService.create.mockResolvedValue({
      id: 'role-1',
      name: 'editor',
    } as any);

    const result = await controller.createRole(
      session,
      { name: 'editor', displayName: 'Editor' } as any,
      undefined,
    );

    expect(result).toEqual({ data: { id: 'role-1', name: 'editor' } });
    expect(roleService.create).toHaveBeenCalledTimes(1);
  });
});
