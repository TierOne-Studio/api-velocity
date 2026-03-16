import { jest } from '@jest/globals';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => {},
  AllowAnonymous: () => () => {},
  BetterAuthGuard: class {},
  BetterAuthModule: { forRoot: jest.fn(() => ({ module: class {} })) },
}));

jest.mock('better-auth/crypto', () => ({
  hashPassword: jest.fn(async (p: string) => `hashed:${p}`),
  verifyPassword: jest.fn(async () => true),
}));

jest.mock('jose', () => ({
  SignJWT: jest.fn().mockImplementation(() => ({
    setProtectedHeader: jest.fn().mockReturnThis(),
    setIssuedAt: jest.fn().mockReturnThis(),
    setExpirationTime: jest.fn().mockReturnThis(),
    sign: jest.fn(async () => 'mock.jwt.token'),
  })),
  importPKCS8: jest.fn(async () => ({})),
  importSPKI: jest.fn(async () => ({})),
  jwtVerify: jest.fn(async () => ({ payload: {} })),
}));

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminUsersController } from './admin-users.controller';
import { AdminService } from '../../application/services';
import { OrgImpersonationService } from '../../../organizations/application/services';
import { PermissionsGuard } from '../../../../../shared';

describe('AdminUsersController', () => {
  let controller: AdminUsersController;
  let adminService: jest.Mocked<AdminService>;
  let impersonationService: jest.Mocked<OrgImpersonationService>;

  const baseSession = {
    user: { id: 'actor-superadmin', role: 'superadmin' },
    session: {},
  } as any;

  beforeEach(() => {
    adminService = {
      getCreateUserMetadata: jest.fn(),
      getUserCapabilities: jest.fn(),
      getBatchCapabilities: jest.fn(),
      listUsers: jest.fn(),
      createUser: jest.fn(),
      listUserSessions: jest.fn(),
      updateUser: jest.fn(),
      setUserRole: jest.fn(),
      banUser: jest.fn(),
      unbanUser: jest.fn(),
      setUserPassword: jest.fn(),
      removeUser: jest.fn(),
      removeUsers: jest.fn(),
      revokeSession: jest.fn(),
      revokeAllSessions: jest.fn(),
    } as unknown as jest.Mocked<AdminService>;

    impersonationService = {
      impersonateUser: jest.fn(),
      startImpersonation: jest.fn(),
      stopImpersonation: jest.fn(),
      getMembership: jest.fn(),
      canImpersonate: jest.fn(),
    } as unknown as jest.Mocked<OrgImpersonationService>;

    controller = new AdminUsersController(adminService, impersonationService);
  });

  it('applies class-level PermissionsGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminUsersController) as unknown[];

    expect(guards).toBeDefined();
    expect(guards).toContain(PermissionsGuard);
  });

  it('passes actor user id to updateUser', async () => {
    adminService.updateUser.mockResolvedValue({ id: 'target-1' } as never);

    await controller.update(baseSession, 'target-1', { name: 'Updated' });

    expect(adminService.updateUser).toHaveBeenCalledWith(
      { userId: 'target-1', name: 'Updated' },
      'superadmin',
      null,
      'actor-superadmin',
    );
  });

  it('passes actor user id to setUserRole', async () => {
    adminService.setUserRole.mockResolvedValue({ id: 'target-1' } as never);

    await controller.setRole(baseSession, 'target-1', { role: 'member' });

    expect(adminService.setUserRole).toHaveBeenCalledWith(
      { userId: 'target-1', role: 'member' },
      'superadmin',
      null,
      'actor-superadmin',
    );
  });

  it('passes actor user id to banUser', async () => {
    adminService.banUser.mockResolvedValue({ success: true } as never);

    await controller.ban(baseSession, 'target-1', { banReason: 'violation' });

    expect(adminService.banUser).toHaveBeenCalledWith(
      { userId: 'target-1', banReason: 'violation' },
      'superadmin',
      null,
      'actor-superadmin',
    );
  });

  it('passes actor user id to unbanUser', async () => {
    adminService.unbanUser.mockResolvedValue({ success: true } as never);

    await controller.unban(baseSession, 'target-1');

    expect(adminService.unbanUser).toHaveBeenCalledWith(
      { userId: 'target-1' },
      'superadmin',
      null,
      'actor-superadmin',
    );
  });

  it('passes actor user id to setUserPassword', async () => {
    adminService.setUserPassword.mockResolvedValue({ status: true } as never);

    await controller.setPassword(baseSession, 'target-1', { newPassword: 'NewPass123!' });

    expect(adminService.setUserPassword).toHaveBeenCalledWith(
      { userId: 'target-1', newPassword: 'NewPass123!' },
      'superadmin',
      null,
      'actor-superadmin',
    );
  });

  it('passes actor user id to removeUser', async () => {
    adminService.removeUser.mockResolvedValue({ success: true } as never);

    await controller.remove(baseSession, 'target-1');

    expect(adminService.removeUser).toHaveBeenCalledWith(
      { userId: 'target-1' },
      'superadmin',
      null,
      'actor-superadmin',
    );
  });

  it('passes actor user id to removeUsers', async () => {
    adminService.removeUsers.mockResolvedValue({ success: true, deletedCount: 2 } as never);

    await controller.bulkRemove(baseSession, { userIds: ['target-1', 'target-2'] });

    expect(adminService.removeUsers).toHaveBeenCalledWith(
      { userIds: ['target-1', 'target-2'] },
      'superadmin',
      null,
      'actor-superadmin',
    );
  });

  it('passes actor context to getBatchCapabilities', async () => {
    adminService.getBatchCapabilities.mockResolvedValue({
      'target-1': {
        targetUserId: 'target-1',
        targetRole: 'member',
        isSelf: false,
        actions: { update: true, setRole: true, ban: true, unban: true, setPassword: true, remove: true, revokeSessions: true, impersonate: true },
      },
    } as never);

    await controller.getBatchCapabilities(baseSession, { userIds: ['target-1'] });

    expect(adminService.getBatchCapabilities).toHaveBeenCalledWith({
      actorUserId: 'actor-superadmin',
      userIds: ['target-1'],
      platformRole: 'superadmin',
      activeOrganizationId: null,
    });
  });

  it('passes actor context to getUserCapabilities', async () => {
    adminService.getUserCapabilities.mockResolvedValue({
      targetUserId: 'target-1',
      targetRole: 'member',
      isSelf: false,
      actions: {
        update: true,
        setRole: true,
        ban: true,
        unban: true,
        setPassword: true,
        remove: true,
        revokeSessions: true,
        impersonate: true,
      },
    } as never);

    await controller.getCapabilities(baseSession, 'target-1');

    expect(adminService.getUserCapabilities).toHaveBeenCalledWith({
      actorUserId: 'actor-superadmin',
      targetUserId: 'target-1',
      platformRole: 'superadmin',
      activeOrganizationId: null,
    });
  });

  describe('manager session — activeOrganizationId propagation', () => {
    const managerSession = {
      user: { id: 'actor-mgr', role: 'manager' },
      session: { activeOrganizationId: 'org-1' },
    } as any;

    it('calls getCreateUserMetadata with manager role and activeOrgId', async () => {
      adminService.getCreateUserMetadata.mockResolvedValue({ roles: [], allowedRoles: [] } as never);

      await controller.getCreateMetadata(managerSession);

      expect(adminService.getCreateUserMetadata).toHaveBeenCalledWith('manager', 'org-1');
    });

    it('passes activeOrgId for manager on update', async () => {
      adminService.updateUser.mockResolvedValue({ id: 'target-1' } as never);

      await controller.update(managerSession, 'target-1', { name: 'X' });

      expect(adminService.updateUser).toHaveBeenCalledWith(
        expect.anything(), 'manager', 'org-1', 'actor-mgr',
      );
    });

    it('passes activeOrgId for manager on remove', async () => {
      adminService.removeUser.mockResolvedValue({ success: true } as never);

      await controller.remove(managerSession, 'target-1');

      expect(adminService.removeUser).toHaveBeenCalledWith(
        expect.anything(), 'manager', 'org-1', 'actor-mgr',
      );
    });
  });

  describe('list', () => {
    it('calls listUsers with parsed pagination and searchValue', async () => {
      adminService.listUsers.mockResolvedValue({ users: [], total: 0 } as never);

      await controller.list(baseSession, '20', '40', 'alice');

      expect(adminService.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20, offset: 40, searchValue: 'alice' }),
      );
    });

    it('calls listUsers without searchValue when omitted', async () => {
      adminService.listUsers.mockResolvedValue({ users: [], total: 0 } as never);

      await controller.list(baseSession, '10', '0');

      expect(adminService.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 0, searchValue: undefined }),
      );
    });
  });

  describe('create', () => {
    it('calls createUser with valid admin payload', async () => {
      adminService.createUser.mockResolvedValue({ id: 'new-1' } as never);

      await controller.create(baseSession, {
        name: 'Alice', email: 'alice@example.com',
        password: 'SecurePass1!', role: 'admin',
      });

      expect(adminService.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Alice', role: 'admin' }),
        'superadmin', null,
      );
    });

    it('calls createUser with member role and organizationId', async () => {
      adminService.createUser.mockResolvedValue({ id: 'new-2' } as never);

      await controller.create(baseSession, {
        name: 'Bob', email: 'bob@example.com',
        password: 'SecurePass1!', role: 'member', organizationId: 'org-1',
      });

      expect(adminService.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'member', organizationId: 'org-1' }),
        'superadmin', null,
      );
    });
  });

  describe('validatePagination — branch coverage', () => {
    it('throws on non-numeric limit', async () => {
      await expect(controller.list(baseSession, 'abc', '0')).rejects.toThrow(
        'limit must be a positive integer',
      );
    });

    it('throws on zero limit', async () => {
      await expect(controller.list(baseSession, '0', '0')).rejects.toThrow(
        'limit must be a positive integer',
      );
    });

    it('throws on negative offset', async () => {
      await expect(controller.list(baseSession, '10', '-1')).rejects.toThrow(
        'offset must be a non-negative integer',
      );
    });

    it('throws on non-numeric offset', async () => {
      await expect(controller.list(baseSession, '10', 'xyz')).rejects.toThrow(
        'offset must be a non-negative integer',
      );
    });
  });

  describe('validateCreatePayload — branch coverage', () => {
    const validBase = { name: 'Alice', email: 'alice@example.com', password: 'SecurePass1!', role: 'admin' as const };

    it('throws when name is missing', async () => {
      await expect(controller.create(baseSession, { ...validBase, name: '' })).rejects.toThrow('name is required');
    });

    it('throws when email is missing', async () => {
      await expect(controller.create(baseSession, { ...validBase, email: '' })).rejects.toThrow('email is required');
    });

    it('throws when password is missing', async () => {
      await expect(controller.create(baseSession, { ...validBase, password: '' })).rejects.toThrow('password is required');
    });

    it('throws when password is too short', async () => {
      await expect(controller.create(baseSession, { ...validBase, password: 'short' })).rejects.toThrow('password must be at least');
    });

    it('throws when role is invalid', async () => {
      await expect(controller.create(baseSession, { ...validBase, role: 'superuser' as any })).rejects.toThrow('invalid role');
    });

    it('throws when non-admin role has no organizationId', async () => {
      await expect(controller.create(baseSession, { ...validBase, role: 'member' })).rejects.toThrow('organizationId is required');
    });
  });

  describe('validateSetRolePayload — branch coverage', () => {
    it('throws when role is invalid', async () => {
      await expect(controller.setRole(baseSession, 'user-1', { role: 'superuser' as any })).rejects.toThrow('invalid role');
    });
  });

  describe('validateSetPasswordPayload — branch coverage', () => {
    it('throws when newPassword is empty', async () => {
      await expect(controller.setPassword(baseSession, 'user-1', { newPassword: '' })).rejects.toThrow('newPassword is required');
    });

    it('throws when newPassword is too short', async () => {
      await expect(controller.setPassword(baseSession, 'user-1', { newPassword: 'short' })).rejects.toThrow('newPassword must be at least');
    });
  });

  describe('validateBulkRemovePayload — branch coverage', () => {
    it('throws when userIds is not an array', async () => {
      await expect(controller.bulkRemove(baseSession, { userIds: 'not-array' as any })).rejects.toThrow('userIds must be an array');
    });
  });

  describe('impersonate', () => {
    it('passes actor context and optional organizationId to shared impersonation service', async () => {
      impersonationService.startImpersonation.mockResolvedValue({ sessionToken: 'imp-token-1' });

      const result = await (controller as any).impersonate(baseSession, 'target-1', { organizationId: 'org-1' });

      expect(impersonationService.startImpersonation).toHaveBeenCalledWith({
        actorUserId: 'actor-superadmin',
        targetUserId: 'target-1',
        platformRole: 'superadmin',
        activeOrganizationId: null,
        organizationId: 'org-1',
      });
      expect(result).toEqual({ success: true, sessionToken: 'imp-token-1' });
    });

    it('uses manager active organization when organizationId is omitted', async () => {
      impersonationService.startImpersonation.mockResolvedValue({ sessionToken: 'imp-token-2' });
      const managerSession = {
        user: { id: 'actor-mgr', role: 'manager' },
        session: { activeOrganizationId: 'org-77' },
      } as any;

      await (controller as any).impersonate(managerSession, 'target-2', {});

      expect(impersonationService.startImpersonation).toHaveBeenCalledWith({
        actorUserId: 'actor-mgr',
        targetUserId: 'target-2',
        platformRole: 'manager',
        activeOrganizationId: 'org-77',
        organizationId: undefined,
      });
    });
  });

});
