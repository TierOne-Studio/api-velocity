import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { RoleService } from '../../modules/admin/rbac/application/services';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;
  let roleService: jest.Mocked<Pick<RoleService, 'getUserPermissions'>>;

  const createMockExecutionContext = (session: unknown): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ session }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as ExecutionContext;
  };

  const makePermission = (resource: string, action: string) => ({
    id: `${resource}-${action}`,
    resource,
    action,
    description: null,
  });

  beforeEach(async () => {
    const mockRoleService = {
      getUserPermissions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        Reflector,
        { provide: RoleService, useValue: mockRoleService },
      ],
    }).compile();

    guard = module.get<PermissionsGuard>(PermissionsGuard);
    reflector = module.get<Reflector>(Reflector);
    roleService = module.get(RoleService);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('when no permissions are required', () => {
    it('should allow access when no permissions metadata', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const context = createMockExecutionContext({ user: { role: 'member' } });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('should allow access when empty permissions array', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
      const context = createMockExecutionContext({ user: { role: 'member' } });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });

  describe('when permissions are required', () => {
    beforeEach(() => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['user:read']);
    });

    it('should allow access for superadmin role without consulting role permissions', async () => {
      const context = createMockExecutionContext({ user: { role: 'superadmin' } });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(roleService.getUserPermissions).not.toHaveBeenCalled();
    });

    it('should allow access for org-scoped role with required permissions in active organization', async () => {
      roleService.getUserPermissions.mockResolvedValueOnce([
        makePermission('user', 'read'),
      ]);
      const context = createMockExecutionContext({
        user: { role: 'manager' },
        session: { activeOrganizationId: 'org-1' },
      });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(roleService.getUserPermissions).toHaveBeenCalledWith('manager', 'org-1');
    });

    it('should deny access for org-scoped role missing required permissions', async () => {
      roleService.getUserPermissions.mockResolvedValueOnce([
        makePermission('role', 'list'),
      ]);
      const context = createMockExecutionContext({
        user: { role: 'member' },
        session: { activeOrganizationId: 'org-1' },
      });
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('should deny access for org-scoped role without active organization', async () => {
      roleService.getUserPermissions.mockResolvedValueOnce([]);
      const context = createMockExecutionContext({ user: { role: 'admin' }, session: {} });
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      expect(roleService.getUserPermissions).toHaveBeenCalledWith('admin', null);
    });

    it('should deny access when no session', async () => {
      const context = createMockExecutionContext(null);
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('should deny access when session has no user', async () => {
      const context = createMockExecutionContext({});
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('should deny access when user has no permissions at all', async () => {
      roleService.getUserPermissions.mockResolvedValueOnce([]);
      const context = createMockExecutionContext({
        user: { role: 'member' },
        session: { activeOrganizationId: 'org-1' },
      });
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('when multiple permissions are required', () => {
    beforeEach(() => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['user:read', 'user:create']);
    });

    it('should allow access when user has all required permissions', async () => {
      roleService.getUserPermissions.mockResolvedValueOnce([
        makePermission('user', 'read'),
        makePermission('user', 'create'),
        makePermission('user', 'update'),
      ]);
      const context = createMockExecutionContext({
        user: { role: 'manager' },
        session: { activeOrganizationId: 'org-1' },
      });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('should deny access when user has only some required permissions', async () => {
      roleService.getUserPermissions.mockResolvedValueOnce([
        makePermission('user', 'read'),
      ]);
      const context = createMockExecutionContext({
        user: { role: 'manager' },
        session: { activeOrganizationId: 'org-1' },
      });
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });
  });
});
