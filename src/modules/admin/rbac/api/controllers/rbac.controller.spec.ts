import { jest } from '@jest/globals';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => {},
  AllowAnonymous: () => () => {},
  BetterAuthGuard: class {},
  BetterAuthModule: { forRoot: jest.fn(() => ({ module: class {} })) },
}));

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { RbacController } from './rbac.controller';
import { RoleService, PermissionService } from '../../application/services';
import { ROLES_KEY, PERMISSIONS_KEY } from '../../../../../shared';
import { PermissionsGuard } from '../../../../../shared';

describe('RbacController metadata', () => {
  let controller: RbacController;
  let roleService: {
    findAll: ReturnType<typeof jest.fn>;
    findById: ReturnType<typeof jest.fn>;
    findByName: ReturnType<typeof jest.fn>;
    findByNameInOrganization: ReturnType<typeof jest.fn>;
    create: ReturnType<typeof jest.fn>;
    update: ReturnType<typeof jest.fn>;
    delete: ReturnType<typeof jest.fn>;
    assignPermissions: ReturnType<typeof jest.fn>;
    getPermissions: ReturnType<typeof jest.fn>;
    getUserPermissions: ReturnType<typeof jest.fn>;
    hasPermission: ReturnType<typeof jest.fn>;
    getUserActiveMemberRole: ReturnType<typeof jest.fn>;
  };
  let permissionService: {
    findAll: ReturnType<typeof jest.fn>;
    findGroupedByResource: ReturnType<typeof jest.fn>;
  };

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
      getUserActiveMemberRole: jest.fn<() => Promise<string | null>>().mockResolvedValue(null),
    };

    permissionService = {
      findAll: jest.fn(),
      findGroupedByResource: jest.fn(),
    };

    controller = new RbacController(
      roleService as unknown as RoleService,
      permissionService as unknown as PermissionService,
    );
  });

  it('returns all permissions for superadmin in getMyPermissions', async () => {
    permissionService.findAll.mockResolvedValue([
      { id: '1', resource: 'organization', action: 'create' },
      { id: '2', resource: 'user', action: 'read' },
    ]);

    const result = await controller.getMyPermissions({
      user: { role: 'superadmin' },
    } as any);

    expect(result).toEqual({
      data: ['organization:create', 'user:read'],
    });
    expect(permissionService.findAll).toHaveBeenCalled();
    expect(roleService.getUserPermissions).not.toHaveBeenCalled();
  });

  it('returns role-based permissions for org-scoped users in getMyPermissions', async () => {
    roleService.getUserPermissions.mockResolvedValue([
      { id: '3', resource: 'organization', action: 'read' },
      { id: '4', resource: 'organization', action: 'invite' },
    ]);

    const result = await controller.getMyPermissions({
      user: { role: 'manager' },
      session: { activeOrganizationId: 'org-1' },
    } as any);

    expect(result).toEqual({
      data: ['organization:read', 'organization:invite'],
    });
    expect(roleService.getUserPermissions).toHaveBeenCalledWith('manager', 'org-1');
    expect(permissionService.findAll).not.toHaveBeenCalled();
  });

  it('returns empty permissions for org-scoped users without active organization in getMyPermissions', async () => {
    const result = await controller.getMyPermissions({
      user: { role: 'admin' },
      session: {},
    } as any);

    expect(result).toEqual({ data: [] });
    expect(roleService.getUserPermissions).not.toHaveBeenCalled();
  });

  it('resolves org membership role when user.role is null (post-Phase0 users)', async () => {
    roleService.getUserActiveMemberRole.mockResolvedValueOnce('admin');
    roleService.getUserPermissions.mockResolvedValue([
      { id: '1', resource: 'user', action: 'read' },
      { id: '2', resource: 'role', action: 'read' },
    ]);

    const result = await controller.getMyPermissions({
      user: { id: 'u-1', role: null },
      session: { activeOrganizationId: 'org-1' },
    } as any);

    expect(roleService.getUserActiveMemberRole).toHaveBeenCalledWith('u-1', 'org-1');
    expect(roleService.getUserPermissions).toHaveBeenCalledWith('admin', 'org-1');
    expect(result).toEqual({ data: ['user:read', 'role:read'] });
  });

  it('applies class-level guards', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, RbacController) as unknown[];

    expect(guards).toBeDefined();
    expect(guards).toContain(PermissionsGuard);
  });

  it('requires role:read for RBAC read operations', () => {
    const methods = ['getRoles', 'getRole', 'getPermissions', 'getPermissionsGrouped', 'getUserPermissions', 'checkPermission'] as const;

    methods.forEach((methodName) => {
      const handler = (controller as unknown as Record<string, unknown>)[methodName] as object;
      const permissions = Reflect.getMetadata(PERMISSIONS_KEY, handler) as string[];
      expect(permissions).toContain('role:read');
    });
  });

  it('does not apply method-level role restrictions on RBAC write operations', () => {
    const methods = ['createRole', 'updateRole', 'deleteRole', 'assignPermissions'] as const;

    methods.forEach((methodName) => {
      const handler = (controller as unknown as Record<string, unknown>)[methodName] as object;
      const roles = Reflect.getMetadata(ROLES_KEY, handler) as string[];
      expect(roles).toBeUndefined();
    });
  });

  it('requires specific role permissions on RBAC write operations', () => {
    const expectations: Array<[keyof RbacController, string]> = [
      ['createRole', 'role:create'],
      ['updateRole', 'role:update'],
      ['deleteRole', 'role:delete'],
      ['assignPermissions', 'role:assign'],
    ];

    expectations.forEach(([methodName, requiredPermission]) => {
      const handler = (controller as unknown as Record<string, unknown>)[methodName] as object;
      const permissions = Reflect.getMetadata(PERMISSIONS_KEY, handler) as string[];
      expect(permissions).toContain(requiredPermission);
    });
  });
});

describe('RbacController handler bodies', () => {
  let controller: RbacController;
  let roleService: {
    findAll: ReturnType<typeof jest.fn>;
    findById: ReturnType<typeof jest.fn>;
    findByName: ReturnType<typeof jest.fn>;
    findByNameInOrganization: ReturnType<typeof jest.fn>;
    create: ReturnType<typeof jest.fn>;
    update: ReturnType<typeof jest.fn>;
    delete: ReturnType<typeof jest.fn>;
    assignPermissions: ReturnType<typeof jest.fn>;
    getPermissions: ReturnType<typeof jest.fn>;
    getUserPermissions: ReturnType<typeof jest.fn>;
    hasPermission: ReturnType<typeof jest.fn>;
    getUserActiveMemberRole: ReturnType<typeof jest.fn>;
  };
  let permissionService: {
    findAll: ReturnType<typeof jest.fn>;
    findGroupedByResource: ReturnType<typeof jest.fn>;
  };

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
      getUserActiveMemberRole: jest.fn<() => Promise<string | null>>().mockResolvedValue(null),
    };

    permissionService = {
      findAll: jest.fn(),
      findGroupedByResource: jest.fn(),
    };

    controller = new RbacController(
      roleService as unknown as RoleService,
      permissionService as unknown as PermissionService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  // ============ getRoles ============

  describe('getRoles', () => {
    it('returns active-org-scoped roles wrapped in data for managers', async () => {
      const roles = [{ id: '1', name: 'admin' }, { id: '2', name: 'member' }];
      roleService.findAll.mockResolvedValue(roles);

      const result = await controller.getRoles({
        user: { role: 'manager' },
        session: { activeOrganizationId: 'org-1' },
      } as any, undefined);

      expect(result).toEqual({ data: roles });
      expect(roleService.findAll).toHaveBeenCalledWith('org-1');
    });

    it('returns explicitly targeted roles for superadmin', async () => {
      const roles = [{ id: '1', name: 'admin' }];
      roleService.findAll.mockResolvedValue(roles);

      const result = await controller.getRoles({
        user: { role: 'superadmin' },
        session: {},
      } as any, 'org-2');

      expect(result).toEqual({ data: roles });
      expect(roleService.findAll).toHaveBeenCalledWith('org-2');
    });

    it('returns all roles for superadmin when organizationId is omitted', async () => {
      const roles = [{ id: '1', name: 'admin' }, { id: '2', name: 'member' }];
      roleService.findAll.mockResolvedValue(roles);

      const result = await controller.getRoles({
        user: { role: 'superadmin' },
        session: {},
      } as any, undefined);

      expect(result).toEqual({ data: roles });
      expect(roleService.findAll).toHaveBeenCalledWith(null);
    });
  });

  // ============ getRole ============

  describe('getRole', () => {
    it('returns role with permissions when found', async () => {
      const role = { id: '1', name: 'admin' };
      const permissions = [{ id: 'p1', resource: 'user', action: 'read' }];
      roleService.findById.mockResolvedValue(role);
      roleService.getPermissions.mockResolvedValue(permissions);

      const result = await controller.getRole('1');

      expect(result).toEqual({ data: { ...role, permissions } });
      expect(roleService.findById).toHaveBeenCalledWith('1');
      expect(roleService.getPermissions).toHaveBeenCalledWith('1');
    });

    it('throws 404 when role not found', async () => {
      roleService.findById.mockResolvedValue(null);

      await expect(controller.getRole('missing')).rejects.toThrow('Role not found');
    });
  });

  // ============ createRole ============

  describe('createRole', () => {
    it('creates role in the active organization and returns it', async () => {
      const dto = { name: 'editor', displayName: 'Editor', description: 'Edit', color: 'blue' };
      const created = { id: '3', ...dto, isDefault: false };
      roleService.findByNameInOrganization.mockResolvedValue(null);
      roleService.create.mockResolvedValue(created);

      const result = await controller.createRole(
        {
          user: { role: 'manager' },
          session: { activeOrganizationId: 'org-1' },
        } as any,
        dto,
        undefined,
      );

      expect(result).toEqual({ data: created });
      expect(roleService.create).toHaveBeenCalledWith(dto, 'org-1');
    });

    it('throws 409 when role name already exists', async () => {
      const dto = { name: 'editor', displayName: 'Editor' };
      roleService.findByNameInOrganization.mockResolvedValue({ id: '1', name: 'editor' });

      await expect(
        controller.createRole(
          {
            user: { role: 'manager' },
            session: { activeOrganizationId: 'org-1' },
          } as any,
          dto,
          undefined,
        ),
      ).rejects.toThrow('Role name already exists');
    });

    it('throws 400 when name is empty', async () => {
      await expect(
        controller.createRole(
          {
            user: { role: 'manager' },
            session: { activeOrganizationId: 'org-1' },
          } as any,
          { name: '', displayName: 'X' } as any,
          undefined,
        ),
      ).rejects.toThrow('Role name is required');
    });

    it('throws 400 when displayName is empty', async () => {
      await expect(
        controller.createRole(
          {
            user: { role: 'manager' },
            session: { activeOrganizationId: 'org-1' },
          } as any,
          { name: 'x', displayName: '' } as any,
          undefined,
        ),
      ).rejects.toThrow('Role displayName is required');
    });

    it('throws when creating a role without an active organization', async () => {
      await expect(
        controller.createRole(
          {
            user: { role: 'admin' },
            session: {},
          } as any,
          { name: 'editor', displayName: 'Editor' },
          undefined,
        ),
      ).rejects.toThrow('Active organization required');
    });

    it('allows superadmin to create a role with explicit organizationId', async () => {
      const dto = { name: 'editor', displayName: 'Editor' };
      const created = { id: '3', ...dto, isDefault: false };
      roleService.findByNameInOrganization.mockResolvedValue(null);
      roleService.create.mockResolvedValue(created);

      const result = await controller.createRole(
        {
          user: { role: 'superadmin' },
          session: {},
        } as any,
        dto,
        'org-9',
      );

      expect(result).toEqual({ data: created });
      expect(roleService.findByNameInOrganization).toHaveBeenCalledWith('editor', 'org-9');
      expect(roleService.create).toHaveBeenCalledWith(dto, 'org-9');
    });
  });

  // ============ updateRole ============

  describe('updateRole', () => {
    it('updates role and returns it', async () => {
      const dto = { displayName: 'Updated' };
      const updated = { id: '2', name: 'editor', displayName: 'Updated' };
      roleService.update.mockResolvedValue(updated);

      const result = await controller.updateRole('2', dto);

      expect(result).toEqual({ data: updated });
    });

    it('throws 404 when role not found', async () => {
      roleService.update.mockResolvedValue(null);

      await expect(controller.updateRole('missing', { displayName: 'X' })).rejects.toThrow('Role not found');
    });

    it('throws 400 when no fields provided', async () => {
      await expect(controller.updateRole('2', {} as any)).rejects.toThrow('At least one field is required');
    });

    it('renames a role when the payload contains a new name', async () => {
      const updated = { id: '2', name: 'owner', displayName: 'Owner' };
      roleService.update.mockResolvedValue(updated);

      const result = await controller.updateRole('2', { name: 'owner' });

      expect(result).toEqual({ data: updated });
      expect(roleService.update).toHaveBeenCalledWith('2', { name: 'owner' });
    });

    it('throws 409 when renaming to an existing role name', async () => {
      roleService.update.mockRejectedValue(new Error('Role name already exists'));

      await expect(controller.updateRole('2', { name: 'owner' })).rejects.toThrow('Role name already exists');
    });

    it('throws 403 when renaming a global role', async () => {
      roleService.update.mockRejectedValue(new Error('Cannot rename global role'));

      await expect(controller.updateRole('2', { name: 'owner' })).rejects.toThrow('Cannot rename global role');
    });
  });

  // ============ deleteRole ============

  describe('deleteRole', () => {
    it('deletes role and returns success', async () => {
      roleService.delete.mockResolvedValue(undefined);

      const result = await controller.deleteRole('2');

      expect(result).toEqual({ success: true });
    });

    it('throws 403 when deleting a global role', async () => {
      roleService.delete.mockRejectedValue(new Error('Cannot delete global role'));

      await expect(controller.deleteRole('1')).rejects.toThrow('Cannot delete global role');
    });

    it('throws 409 when deleting a role that is still assigned', async () => {
      roleService.delete.mockRejectedValue(new Error('Role is still assigned and cannot be deleted'));

      await expect(controller.deleteRole('1')).rejects.toThrow('Role is still assigned and cannot be deleted');
    });

    it('throws 404 when role not found', async () => {
      roleService.delete.mockRejectedValue(new Error('Role not found'));

      await expect(controller.deleteRole('missing')).rejects.toThrow('Role not found');
    });

    it('re-throws unknown errors', async () => {
      roleService.delete.mockRejectedValue(new Error('DB connection lost'));

      await expect(controller.deleteRole('2')).rejects.toThrow('DB connection lost');
    });

    it('re-throws non-Error objects', async () => {
      roleService.delete.mockRejectedValue('string error');

      await expect(controller.deleteRole('2')).rejects.toBe('string error');
    });
  });

  // ============ assignPermissions ============

  describe('assignPermissions', () => {
    it('assigns permissions and returns role with permissions', async () => {
      const role = { id: '2', name: 'editor' };
      const permissions = [{ id: 'p1', resource: 'user', action: 'read' }];
      roleService.findById.mockResolvedValue(role);
      roleService.assignPermissions.mockResolvedValue(undefined);
      roleService.getPermissions.mockResolvedValue(permissions);

      const result = await controller.assignPermissions('2', { permissionIds: ['p1'] });

      expect(result).toEqual({ data: { ...role, permissions } });
      expect(roleService.assignPermissions).toHaveBeenCalledWith('2', ['p1']);
    });

    it('throws 404 when role not found', async () => {
      roleService.findById.mockResolvedValue(null);

      await expect(
        controller.assignPermissions('missing', { permissionIds: ['p1'] }),
      ).rejects.toThrow('Role not found');
    });

    it('throws 400 when permissionIds is not an array', async () => {
      await expect(
        controller.assignPermissions('2', { permissionIds: 'not-array' } as any),
      ).rejects.toThrow('permissionIds must be an array');
    });
  });

  // ============ getPermissions ============

  describe('getPermissions', () => {
    it('returns all permissions', async () => {
      const permissions = [{ id: 'p1', resource: 'user', action: 'read' }];
      permissionService.findAll.mockResolvedValue(permissions);

      const result = await controller.getPermissions();

      expect(result).toEqual({ data: permissions });
    });
  });

  // ============ getPermissionsGrouped ============

  describe('getPermissionsGrouped', () => {
    it('returns permissions grouped by resource', async () => {
      const grouped = { user: [{ id: 'p1', resource: 'user', action: 'read' }] };
      permissionService.findGroupedByResource.mockResolvedValue(grouped);

      const result = await controller.getPermissionsGrouped();

      expect(result).toEqual({ data: grouped });
    });
  });

  // ============ getUserPermissions ============

  describe('getUserPermissions', () => {
    it('returns permissions for a role name', async () => {
      const permissions = [{ id: 'p1', resource: 'user', action: 'read' }];
      roleService.getUserPermissions.mockResolvedValue(permissions);

      const result = await controller.getUserPermissions(
        { session: { activeOrganizationId: 'org-1' } } as any,
        'manager',
      );

      expect(result).toEqual({ data: permissions });
      expect(roleService.getUserPermissions).toHaveBeenCalledWith('manager', 'org-1');
    });
  });

  // ============ checkPermission ============

  describe('checkPermission', () => {
    it('returns true when role has permission', async () => {
      roleService.hasPermission.mockResolvedValue(true);

      const result = await controller.checkPermission('admin', 'user', 'read');

      expect(result).toEqual({ data: { hasPermission: true } });
      expect(roleService.hasPermission).toHaveBeenCalledWith('admin', 'user', 'read');
    });

    it('returns false when role lacks permission', async () => {
      roleService.hasPermission.mockResolvedValue(false);

      const result = await controller.checkPermission('member', 'user', 'delete');

      expect(result).toEqual({ data: { hasPermission: false } });
    });
  });

  // ============ validateUpdateRolePayload edge cases ============

  describe('updateRole payload validation', () => {
    it('throws 400 when name is provided but consists only of whitespace (line 62)', async () => {
      await expect(controller.updateRole('r-1', { name: '   ' })).rejects.toThrow('Role name is required');
    });

    it('throws 400 when name is a reserved word — superadmin (line 66)', async () => {
      await expect(controller.updateRole('r-1', { name: 'superadmin' })).rejects.toThrow('reserved');
    });

    it('throws 400 when name is a reserved word — user (line 66)', async () => {
      await expect(controller.updateRole('r-1', { name: 'user' })).rejects.toThrow('reserved');
    });
  });

  // ============ resolveTargetOrganizationId edge cases ============

  describe('createRole resolveTargetOrganizationId edge cases', () => {
    it('throws 400 when superadmin does not supply organizationId (line 81)', async () => {
      await expect(
        controller.createRole(
          { user: { role: 'superadmin' }, session: {} } as any,
          { name: 'editor', displayName: 'Editor' },
          undefined,  // no organizationId
        ),
      ).rejects.toThrow('organizationId is required');
    });
  });

  // ============ resolveRoleListOrganizationId edge cases ============

  describe('getRoles resolveRoleListOrganizationId edge cases', () => {
    it('throws 403 when non-superadmin has no active organization (line 105)', async () => {
      await expect(
        controller.getRoles(
          { user: { role: 'admin' }, session: {} } as any,
          undefined,
        ),
      ).rejects.toThrow('Active organization required');
    });
  });

  // ============ getMyPermissions edge cases ============

  describe('getMyPermissions edge cases', () => {
    it('throws ForbiddenException when session has no user (line 120)', async () => {
      await expect(controller.getMyPermissions({} as any)).rejects.toThrow('Authentication required');
    });

    it('returns empty data array when non-superadmin has no active organization', async () => {
      const result = await controller.getMyPermissions({
        user: { id: 'user-1', role: 'admin' },
        session: {},
      } as any);

      expect(result).toEqual({ data: [] });
    });
  });
});
