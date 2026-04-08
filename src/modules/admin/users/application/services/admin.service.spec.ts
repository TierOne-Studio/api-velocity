import { jest } from '@jest/globals';

jest.mock('better-auth/crypto', () => ({
  hashPassword: jest.fn(async (password: string) => `hashed:${password}`),
  verifyPassword: jest.fn(async () => true),
}));

jest.mock('../../utils/verification.utils', () => ({
  buildVerificationToken: jest.fn(async () => 'mock.jwt.token'),
  buildVerificationUrl: jest.fn(
    () =>
      'http://localhost:3000/api/auth/verify-email?token=mock.jwt.token&callbackURL=http%3A%2F%2Flocalhost%3A5173',
  ),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AdminService, CreateUserInput } from './admin.service';
import {
  ADMIN_USER_REPOSITORY,
  type IAdminUserRepository,
} from '../../domain/repositories/admin-user.repository.interface';
import { EmailService } from '../../../../../shared/email/email.service';
import { ConfigService } from '../../../../../shared/config/config.service';

describe('AdminService', () => {
  let service: AdminService;
  let userRepo: jest.Mocked<IAdminUserRepository>;
  let emailService: jest.Mocked<EmailService>;

  const mockRoles = [
    {
      name: 'admin',
      display_name: 'Admin',
      description: 'Platform admin',
      color: '#ff0000',
      is_default: true,
    },
    {
      name: 'manager',
      display_name: 'Manager',
      description: 'Org manager',
      color: '#00ff00',
      is_default: true,
    },
    {
      name: 'member',
      display_name: 'Member',
      description: 'Regular user',
      color: '#0000ff',
      is_default: true,
    },
  ];

  const mockOrganizations = [
    { id: 'org-1', name: 'Org 1', slug: 'org-1' },
    { id: 'org-2', name: 'Org 2', slug: 'org-2' },
  ];

  const mockUser = {
    id: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    role: 'member',
    emailVerified: false,
    image: null as string | null,
    banned: false as boolean | null,
    banReason: null as string | null,
    banExpires: null as Date | null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockUserRepo: jest.Mocked<IAdminUserRepository> = {
      findUserRole: jest.fn(),
      findUserById: jest.fn(),
      findMemberInOrg: jest.fn(),
      findUserOrganization: jest.fn(),
      updateUser: jest.fn(),
      setUserRole: jest.fn(),
      banUser: jest.fn(),
      unbanUser: jest.fn(),
      setUserPassword: jest.fn(),
      removeUser: jest.fn(),
      removeUsers: jest.fn(),
      listUsers: jest.fn(),
      createUser: jest.fn(),
      findSessionByToken: jest.fn(),
      revokeSession: jest.fn(),
      revokeAllSessions: jest.fn(),
      listUserSessions: jest.fn(),
      listRoles: jest.fn(),
      listOrganizations: jest.fn(),
      findOrganizationById: jest.fn(),
    };

    const mockEmailService = {
      sendEmailVerification: jest
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined),
      sendPasswordResetEmail: jest
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined),
      sendOrganizationInvitation: jest
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined),
    };

    const mockConfigService = {
      getBaseUrl: jest.fn().mockReturnValue('http://localhost:3000'),
      getFeUrl: jest.fn().mockReturnValue('http://localhost:5173'),
      getAuthSecret: jest
        .fn()
        .mockReturnValue('test-secret-key-for-jwt-signing'),
      isTestMode: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: ADMIN_USER_REPOSITORY, useValue: mockUserRepo },
        { provide: EmailService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    userRepo = module.get(ADMIN_USER_REPOSITORY);
    emailService = module.get(EmailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getCreateUserMetadata', () => {
    it('should return all roles and organizations for superadmin', async () => {
      userRepo.listRoles.mockResolvedValueOnce(mockRoles);
      userRepo.listOrganizations.mockResolvedValueOnce(mockOrganizations);

      const result = await service.getCreateUserMetadata('superadmin', null);

      expect(result.allowedRoleNames).toEqual(['admin', 'manager', 'member']);
      expect(result.organizations).toHaveLength(2);
      expect(result.roles).toHaveLength(3);
    });

    it('should return admin/manager/member roles but only the active organization for org admin', async () => {
      userRepo.listRoles.mockResolvedValueOnce(mockRoles);
      userRepo.findOrganizationById.mockResolvedValueOnce(mockOrganizations[0]);

      const result = await service.getCreateUserMetadata('admin', 'org-1');

      expect(result.allowedRoleNames).toEqual(['admin', 'manager', 'member']);
      expect(result.organizations).toEqual([mockOrganizations[0]]);
    });

    it('should return only manager/member roles for manager', async () => {
      userRepo.listRoles.mockResolvedValueOnce(mockRoles);
      userRepo.findOrganizationById.mockResolvedValueOnce(mockOrganizations[0]);

      const result = await service.getCreateUserMetadata('manager', 'org-1');

      expect(result.allowedRoleNames).toEqual(['manager', 'member']);
      expect(result.organizations).toHaveLength(1);
    });

    it('should throw ForbiddenException for manager without active organization', async () => {
      await expect(
        service.getCreateUserMetadata('manager', null),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for admin without active organization', async () => {
      await expect(
        service.getCreateUserMetadata('admin', null),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createUser - Role Hierarchy', () => {
    const baseUserInput: CreateUserInput = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'SecurePass123!',
      role: 'member',
      organizationId: 'org-1',
    };

    it('should throw ForbiddenException when manager tries to create admin', async () => {
      const input: CreateUserInput = { ...baseUserInput, role: 'admin' };
      await expect(
        service.createUser(input, 'manager', 'org-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when manager creates user in different org', async () => {
      const input: CreateUserInput = {
        ...baseUserInput,
        organizationId: 'org-2',
      };
      await expect(
        service.createUser(input, 'manager', 'org-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for org-scoped role without organization', async () => {
      const input: CreateUserInput = {
        ...baseUserInput,
        role: 'member',
        organizationId: undefined,
      };
      await expect(
        service.createUser(input, 'superadmin', null),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('setUserRole', () => {
    it('should throw ForbiddenException when manager tries to assign admin role', async () => {
      await expect(
        service.setUserRole(
          { userId: 'user-1', role: 'admin' },
          'manager',
          'org-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when manager has no active organization', async () => {
      await expect(
        service.setUserRole(
          { userId: 'user-1', role: 'manager' },
          'manager',
          null,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows manager to set role when user is in the active org (covers assertUserInManagerOrg path, line 170)', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('member');
      userRepo.findMemberInOrg.mockResolvedValueOnce({ id: 'm-1' });
      userRepo.setUserRole.mockResolvedValueOnce({
        ...mockUser,
        role: 'member',
      });

      const result = await service.setUserRole(
        { userId: 'target-1', role: 'member' },
        'manager',
        'org-1',
        'actor-manager',
      );

      expect(result.role).toBe('member');
    });

    it('should throw ForbiddenException when user tries to change own role', async () => {
      await expect(
        service.setUserRole(
          { userId: 'user-1', role: 'member' },
          'superadmin',
          null,
          'user-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow superadmin to change manager to member using target membership org when no active organization', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('manager');
      userRepo.findUserOrganization.mockResolvedValueOnce({
        organizationId: 'org-1',
      });
      userRepo.setUserRole.mockResolvedValueOnce({
        ...mockUser,
        id: 'target-1',
        role: 'member',
      });

      const result = await service.setUserRole(
        { userId: 'target-1', role: 'member' },
        'superadmin',
        null,
        'actor-superadmin',
      );

      expect(result.role).toBe('member');
      expect(userRepo.setUserRole).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'target-1',
          role: 'member',
          organizationId: 'org-1',
        }),
      );
    });

    it('should throw BadRequestException for org-scoped role change when no org can be resolved', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('manager');
      userRepo.findUserOrganization.mockResolvedValueOnce(null);

      await expect(
        service.setUserRole(
          { userId: 'target-1', role: 'member' },
          'superadmin',
          null,
          'actor-superadmin',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow self-update', async () => {
      userRepo.updateUser.mockResolvedValueOnce({
        ...mockUser,
        name: 'Self Updated',
      });

      const result = await service.updateUser(
        { userId: 'user-1', name: 'Self Updated' },
        'superadmin',
        null,
        'user-1',
      );

      expect(result.name).toBe('Self Updated');
    });

    it('should allow self password reset', async () => {
      userRepo.setUserPassword.mockResolvedValueOnce(undefined);

      const result = await service.setUserPassword(
        { userId: 'user-1', newPassword: 'NewPass123!' },
        'superadmin',
        null,
        'user-1',
      );

      expect(result.status).toBe(true);
    });

    it('should block self-unban', async () => {
      await expect(
        service.unbanUser({ userId: 'user-1' }, 'superadmin', null, 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should block self-delete', async () => {
      await expect(
        service.removeUser({ userId: 'user-1' }, 'superadmin', null, 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow superadmin to delete another admin', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('admin');
      userRepo.removeUser.mockResolvedValueOnce(undefined);

      const result = await service.removeUser(
        { userId: 'target-admin' },
        'superadmin',
        null,
        'actor-superadmin',
      );

      expect(result.success).toBe(true);
    });

    it('should block manager from updating manager', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('manager');

      await expect(
        service.updateUser(
          { userId: 'target-manager', name: 'Nope' },
          'manager',
          'org-1',
          'actor-manager',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should block bulk delete when target list includes self', async () => {
      await expect(
        service.removeUsers(
          { userIds: ['user-1', 'user-2'] },
          'superadmin',
          null,
          'user-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('target action policy', () => {
    it('should allow superadmin to ban another admin', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('admin');
      userRepo.banUser.mockResolvedValueOnce(undefined);

      const result = await service.banUser(
        { userId: 'target-admin', banReason: 'Violation' },
        'superadmin',
        null,
        'actor-superadmin',
      );

      expect(result.success).toBe(true);
    });

    it('should block manager from banning another manager', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('manager');

      await expect(
        service.banUser(
          { userId: 'target-manager', banReason: 'Violation' },
          'manager',
          'org-1',
          'actor-manager',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should block self-ban', async () => {
      await expect(
        service.banUser(
          { userId: 'user-1', banReason: 'Violation' },
          'superadmin',
          null,
          'user-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listUsers', () => {
    it('should return all users for superadmin', async () => {
      userRepo.listUsers.mockResolvedValueOnce({ data: [mockUser], total: 1 });

      const result = await service.listUsers({
        limit: 10,
        offset: 0,
        platformRole: 'superadmin',
        activeOrganizationId: null,
      });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should preserve memberships returned by the repository', async () => {
      userRepo.listUsers.mockResolvedValueOnce({
        data: [
          {
            ...mockUser,
            memberships: [
              {
                organizationId: 'org-1',
                organizationName: 'Org 1',
                roleName: 'manager',
                roleDisplayName: 'Manager',
              },
            ],
          },
        ],
        total: 1,
      } as never);

      const result = await service.listUsers({
        limit: 10,
        offset: 0,
        platformRole: 'superadmin',
        activeOrganizationId: null,
      });

      expect(result.data[0]).toEqual(
        expect.objectContaining({
          memberships: [
            {
              organizationId: 'org-1',
              organizationName: 'Org 1',
              roleName: 'manager',
              roleDisplayName: 'Manager',
            },
          ],
        }),
      );
    });

    it('should forward organizationId for superadmin filtering', async () => {
      userRepo.listUsers.mockResolvedValueOnce({ data: [mockUser], total: 1 });

      await service.listUsers({
        limit: 10,
        offset: 0,
        searchValue: undefined,
        organizationId: 'org-2',
        platformRole: 'superadmin',
        activeOrganizationId: null,
      });

      expect(userRepo.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-2',
          platformRole: 'superadmin',
        }),
      );
    });

    it('should throw ForbiddenException for manager without active organization', async () => {
      await expect(
        service.listUsers({
          limit: 10,
          offset: 0,
          platformRole: 'manager',
          activeOrganizationId: null,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateUser', () => {
    it('should allow superadmin to update any user', async () => {
      userRepo.updateUser.mockResolvedValueOnce({
        ...mockUser,
        name: 'Updated Name',
      });

      const result = await service.updateUser(
        { userId: 'user-1', name: 'Updated Name' },
        'superadmin',
        null,
      );

      expect(result.name).toBe('Updated Name');
    });

    it('throws ForbiddenException when non-superadmin has no active organization (line 143)', async () => {
      await expect(
        service.updateUser({ userId: 'user-1', name: 'X' }, 'admin', null),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows admin with active org to update user in that org (line 143)', async () => {
      userRepo.findMemberInOrg.mockResolvedValueOnce({
        id: 'member-1',
      } as never);
      userRepo.updateUser.mockResolvedValueOnce({
        ...mockUser,
        name: 'Updated',
      });
      const result = await service.updateUser(
        { userId: 'user-1', name: 'Updated' },
        'admin',
        'org-1',
      );
      expect(result.name).toBe('Updated');
    });
  });

  describe('banUser', () => {
    it('should allow superadmin to ban any user', async () => {
      userRepo.banUser.mockResolvedValueOnce(undefined);
      const result = await service.banUser(
        { userId: 'user-1', banReason: 'Violation' },
        'superadmin',
        null,
      );
      expect(result.success).toBe(true);
    });

    it('throws ForbiddenException when non-superadmin has no active organization (line 207)', async () => {
      await expect(
        service.banUser({ userId: 'user-1', banReason: 'test' }, 'admin', null),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows admin with active org to ban user in that org (line 207)', async () => {
      userRepo.findMemberInOrg.mockResolvedValueOnce({
        id: 'member-1',
      } as never);
      userRepo.banUser.mockResolvedValueOnce(undefined);
      const result = await service.banUser(
        { userId: 'user-1', banReason: 'spam' },
        'admin',
        'org-1',
      );
      expect(result.success).toBe(true);
    });
  });

  describe('unbanUser', () => {
    it('should allow superadmin to unban any user', async () => {
      userRepo.unbanUser.mockResolvedValueOnce(undefined);
      const result = await service.unbanUser(
        { userId: 'user-1' },
        'superadmin',
        null,
      );
      expect(result.success).toBe(true);
    });

    it('throws ForbiddenException when non-superadmin has no active organization (line 229)', async () => {
      await expect(
        service.unbanUser({ userId: 'user-2' }, 'admin', null),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows admin with active org to unban user in that org (line 229)', async () => {
      userRepo.findMemberInOrg.mockResolvedValueOnce({
        id: 'member-1',
      } as never);
      userRepo.unbanUser.mockResolvedValueOnce(undefined);
      const result = await service.unbanUser(
        { userId: 'user-2' },
        'admin',
        'org-1',
      );
      expect(result.success).toBe(true);
    });
  });

  describe('setUserPassword', () => {
    it('should allow superadmin to change any user password', async () => {
      userRepo.setUserPassword.mockResolvedValueOnce(undefined);
      const result = await service.setUserPassword(
        { userId: 'user-1', newPassword: 'NewPass123!' },
        'superadmin',
        null,
      );
      expect(result.status).toBe(true);
    });

    it('throws ForbiddenException when non-superadmin has no active organization (line 251)', async () => {
      await expect(
        service.setUserPassword(
          { userId: 'user-1', newPassword: 'NewPass123!' },
          'admin',
          null,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows admin with active org to set password for user in that org (line 251)', async () => {
      userRepo.findMemberInOrg.mockResolvedValueOnce({
        id: 'member-1',
      } as never);
      userRepo.setUserPassword.mockResolvedValueOnce(undefined);
      const result = await service.setUserPassword(
        { userId: 'user-1', newPassword: 'NewPass123!' },
        'admin',
        'org-1',
      );
      expect(result.status).toBe(true);
    });
  });

  describe('removeUser', () => {
    it('should allow superadmin to delete any user', async () => {
      userRepo.removeUser.mockResolvedValueOnce(undefined);
      const result = await service.removeUser(
        { userId: 'user-1' },
        'superadmin',
        null,
      );
      expect(result.success).toBe(true);
    });

    it('throws ForbiddenException when non-superadmin has no active organization (line 274)', async () => {
      await expect(
        service.removeUser({ userId: 'user-1' }, 'admin', null),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows admin with active org to remove user in that org (line 274)', async () => {
      userRepo.findMemberInOrg.mockResolvedValueOnce({
        id: 'member-1',
      } as never);
      userRepo.removeUser.mockResolvedValueOnce(undefined);
      const result = await service.removeUser(
        { userId: 'user-1' },
        'admin',
        'org-1',
      );
      expect(result.success).toBe(true);
    });
  });

  describe('removeUsers (bulk delete)', () => {
    it('should allow superadmin to bulk delete users and return actual deleted count', async () => {
      userRepo.removeUsers.mockResolvedValueOnce(3);
      const result = await service.removeUsers(
        { userIds: ['user-1', 'user-2', 'user-3'] },
        'superadmin',
        null,
      );
      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(3);
    });

    it('should reflect actual count when some ids were not found', async () => {
      userRepo.removeUsers.mockResolvedValueOnce(2);
      const result = await service.removeUsers(
        { userIds: ['user-1', 'user-2', 'ghost-id'] },
        'superadmin',
        null,
      );
      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2);
    });

    it('should return early for empty userIds array', async () => {
      const result = await service.removeUsers(
        { userIds: [] },
        'superadmin',
        null,
      );
      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(0);
    });

    it('should throw ForbiddenException for manager without active organization', async () => {
      await expect(
        service.removeUsers({ userIds: ['user-1', 'user-2'] }, 'manager', null),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when manager tries to delete user outside org', async () => {
      userRepo.findMemberInOrg.mockResolvedValueOnce(null);
      await expect(
        service.removeUsers({ userIds: ['user-1'] }, 'manager', 'org-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow manager to bulk delete users in their organization', async () => {
      userRepo.findMemberInOrg
        .mockResolvedValueOnce({ id: 'member-1' })
        .mockResolvedValueOnce({ id: 'member-2' });
      userRepo.removeUsers.mockResolvedValueOnce(2);
      const result = await service.removeUsers(
        { userIds: ['user-1', 'user-2'] },
        'manager',
        'org-1',
      );
      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2);
    });
  });

  describe('createUser - happy path', () => {
    it('should allow superadmin to create a member with organization', async () => {
      const createdUser = {
        ...mockUser,
        id: 'new-user-1',
        name: 'New Member',
        email: 'newmember@example.com',
        role: 'member',
      };
      userRepo.createUser.mockResolvedValueOnce(createdUser);

      const result = await service.createUser(
        {
          name: 'New Member',
          email: 'newmember@example.com',
          password: 'SecurePass123!',
          role: 'member',
          organizationId: 'org-1',
        },
        'superadmin',
        null,
      );

      expect(result).toEqual(createdUser);
    });

    it('should allow superadmin to create an admin user with organization', async () => {
      const createdUser = {
        ...mockUser,
        id: 'new-admin-1',
        name: 'New Admin',
        email: 'newadmin@example.com',
        role: 'admin',
      };
      userRepo.createUser.mockResolvedValueOnce(createdUser);

      const result = await service.createUser(
        {
          name: 'New Admin',
          email: 'newadmin@example.com',
          password: 'SecurePass123!',
          role: 'admin',
          organizationId: 'org-1',
        },
        'superadmin',
        null,
      );

      expect(result).toEqual(createdUser);
    });

    it('should throw ForbiddenException when user already exists', async () => {
      userRepo.createUser.mockRejectedValueOnce(
        new ForbiddenException('User already exists'),
      );

      await expect(
        service.createUser(
          {
            name: 'Existing User',
            email: 'existing@example.com',
            password: 'SecurePass123!',
            role: 'member',
            organizationId: 'org-1',
          },
          'superadmin',
          null,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('still returns created user when email sending fails (line 452)', async () => {
      const createdUser = {
        ...mockUser,
        id: 'new-user-email-fail',
        email: 'fail@example.com',
      };
      userRepo.createUser.mockResolvedValueOnce(createdUser);
      emailService.sendEmailVerification.mockRejectedValueOnce(
        new Error('Email service unavailable') as never,
      );

      const result = await service.createUser(
        {
          name: 'Fail Email User',
          email: 'fail@example.com',
          password: 'SecurePass123!',
          role: 'member',
          organizationId: 'org-1',
        },
        'superadmin',
        null,
      );

      expect(result).toEqual(createdUser);
    });
  });

  describe('listUsers with search', () => {
    it('should filter users by searchValue', async () => {
      userRepo.listUsers.mockResolvedValueOnce({ data: [mockUser], total: 1 });

      const result = await service.listUsers({
        limit: 10,
        offset: 0,
        searchValue: 'test',
        platformRole: 'superadmin',
        activeOrganizationId: null,
      });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should filter users by org for manager', async () => {
      userRepo.listUsers.mockResolvedValueOnce({ data: [mockUser], total: 1 });

      const result = await service.listUsers({
        limit: 10,
        offset: 0,
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
      });

      expect(result.data).toHaveLength(1);
    });
  });

  describe('getTargetRole — branch coverage', () => {
    it('returns null when user row not found — covers !row branch', async () => {
      userRepo.findUserRole.mockResolvedValueOnce(null);

      await expect(
        service.getUserCapabilities({
          actorUserId: 'admin-1',
          targetUserId: 'missing-user',
          platformRole: 'superadmin',
          activeOrganizationId: null,
        }),
      ).rejects.toThrow('Target user not found');
    });

    it('returns member fallback for unknown role string — covers return member branch', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('custom-unknown-role');
      userRepo.findMemberInOrg.mockResolvedValueOnce({ id: 'member-row' });

      const result = await service.getUserCapabilities({
        actorUserId: 'manager-1',
        targetUserId: 'user-x',
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
      });

      expect(result.targetRole).toBe('member');
    });
  });

  describe('assertTargetActionAllowed — branch coverage', () => {
    it('returns early when actorUserId is undefined', async () => {
      userRepo.updateUser.mockResolvedValueOnce({
        ...mockUser,
        name: 'Updated',
      });

      const result = await service.updateUser(
        { userId: 'user-1', name: 'Updated' },
        'superadmin',
        null,
        undefined,
      );

      expect(result.name).toBe('Updated');
    });

    it('throws when target user not found', async () => {
      userRepo.findUserRole.mockResolvedValueOnce(null);

      await expect(
        service.banUser(
          { userId: 'ghost-user' },
          'superadmin',
          null,
          'actor-1',
        ),
      ).rejects.toThrow('Target user not found');
    });
  });

  describe('updateUser — branch coverage', () => {
    it('throws when manager has no active organization', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('member');

      await expect(
        service.updateUser(
          { userId: 'user-1', name: 'X' },
          'manager',
          null,
          'actor-mgr',
        ),
      ).rejects.toThrow('Active organization required');
    });

    it('throws when no fields to update', async () => {
      await expect(
        service.updateUser({ userId: 'user-1' }, 'superadmin', null, undefined),
      ).rejects.toThrow('No data to update');
    });
  });

  describe('banUser — branch coverage', () => {
    it('throws when manager has no active organization', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('member');

      await expect(
        service.banUser({ userId: 'user-1' }, 'manager', null, 'actor-mgr'),
      ).rejects.toThrow('Active organization required');
    });
  });

  describe('unbanUser — branch coverage', () => {
    it('throws when manager has no active organization', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('member');

      await expect(
        service.unbanUser({ userId: 'user-1' }, 'manager', null, 'actor-mgr'),
      ).rejects.toThrow('Active organization required');
    });
  });

  describe('setUserPassword — branch coverage', () => {
    it('throws when manager has no active organization', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('member');

      await expect(
        service.setUserPassword(
          { userId: 'user-1', newPassword: 'Pass123!' },
          'manager',
          null,
          'actor-mgr',
        ),
      ).rejects.toThrow('Active organization required');
    });
  });

  describe('removeUser — branch coverage', () => {
    it('throws when manager has no active organization', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('member');

      await expect(
        service.removeUser({ userId: 'user-1' }, 'manager', null, 'actor-mgr'),
      ).rejects.toThrow('Active organization required');
    });
  });

  describe('listUsers — branch coverage', () => {
    it('returns total 0 when repository returns 0', async () => {
      userRepo.listUsers.mockResolvedValueOnce({ data: [], total: 0 });

      const result = await service.listUsers({
        limit: 10,
        offset: 0,
        platformRole: 'superadmin',
        activeOrganizationId: null,
      });

      expect(result.total).toBe(0);
    });
  });

  describe('setUserRole — insert new member branch coverage', () => {
    it('calls setUserRole with correct params when member does not exist in org', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('member');
      userRepo.findUserOrganization.mockResolvedValueOnce({
        organizationId: 'org-1',
      });
      userRepo.setUserRole.mockResolvedValueOnce({
        ...mockUser,
        id: 'target-1',
        role: 'manager',
      });

      await service.setUserRole(
        { userId: 'target-1', role: 'manager' },
        'superadmin',
        null,
        'actor-superadmin',
      );

      expect(userRepo.setUserRole).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'target-1',
          role: 'manager',
          organizationId: 'org-1',
        }),
      );
    });
  });

  describe('getUserCapabilities — branch coverage', () => {
    it('throws when target user not found', async () => {
      userRepo.findUserRole.mockResolvedValueOnce(null);

      await expect(
        service.getUserCapabilities({
          actorUserId: 'admin-1',
          targetUserId: 'ghost',
          platformRole: 'superadmin',
          activeOrganizationId: null,
        }),
      ).rejects.toThrow('Target user not found');
    });

    it('sets isTargetInActiveOrganization=false when manager has no activeOrgId', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('member');

      const result = await service.getUserCapabilities({
        actorUserId: 'manager-1',
        targetUserId: 'user-1',
        platformRole: 'manager',
        activeOrganizationId: null,
      });

      expect(result.actions.update).toBe(false);
      expect(result.actions.ban).toBe(false);
    });
  });

  describe('getUserCapabilities', () => {
    it('returns self-safe capabilities for superadmin acting on self', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('admin');

      const result = await service.getUserCapabilities({
        actorUserId: 'superadmin-1',
        targetUserId: 'superadmin-1',
        platformRole: 'superadmin',
        activeOrganizationId: null,
      });

      expect(result.isSelf).toBe(true);
      expect(result.actions.update).toBe(true);
      expect(result.actions.setPassword).toBe(true);
      expect(result.actions.setRole).toBe(false);
      expect(result.actions.ban).toBe(false);
      expect(result.actions.remove).toBe(false);
      expect(result.actions.impersonate).toBe(false);
    });

    it('blocks admin from sensitive actions against another admin', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('admin');

      const result = await service.getUserCapabilities({
        actorUserId: 'admin-1',
        targetUserId: 'admin-2',
        platformRole: 'admin',
        activeOrganizationId: null,
      });

      expect(result.isSelf).toBe(false);
      expect(result.actions.update).toBe(false);
      expect(result.actions.setRole).toBe(false);
      expect(result.actions.ban).toBe(false);
      expect(result.actions.remove).toBe(false);
      expect(result.actions.revokeSessions).toBe(false);
      expect(result.actions.impersonate).toBe(false);
    });

    it('allows manager actions on member in active organization only', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('member');
      userRepo.findMemberInOrg.mockResolvedValueOnce({ id: 'member-row' });

      const result = await service.getUserCapabilities({
        actorUserId: 'manager-1',
        targetUserId: 'member-1',
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
      });

      expect(result.actions.update).toBe(true);
      expect(result.actions.setRole).toBe(true);
      expect(result.actions.ban).toBe(true);
      expect(result.actions.remove).toBe(true);
      expect(result.actions.impersonate).toBe(true);
    });

    it('superadmin can act on user with null platform role (post-migration users)', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('member'); // null role → 'member' via repo fallback

      const result = await service.getUserCapabilities({
        actorUserId: 'superadmin-1',
        targetUserId: 'regular-user-1',
        platformRole: 'superadmin',
        activeOrganizationId: null,
      });

      expect(result.isSelf).toBe(false);
      expect(result.actions.update).toBe(true);
      expect(result.actions.setRole).toBe(true);
      expect(result.actions.ban).toBe(true);
      expect(result.actions.remove).toBe(true);
      expect(result.actions.impersonate).toBe(true);
    });
  });

  describe('getBatchCapabilities', () => {
    it('returns empty object when userIds is empty', async () => {
      const result = await service.getBatchCapabilities({
        actorUserId: 'admin-1',
        userIds: [],
        platformRole: 'admin',
        activeOrganizationId: null,
      });

      expect(result).toEqual({});
      expect(userRepo.findUserRole).not.toHaveBeenCalled();
    });

    it('returns capabilities keyed by userId for multiple users', async () => {
      userRepo.findUserRole
        .mockResolvedValueOnce('member')
        .mockResolvedValueOnce('manager');

      const result = await service.getBatchCapabilities({
        actorUserId: 'superadmin-1',
        userIds: ['user-1', 'user-2'],
        platformRole: 'superadmin',
        activeOrganizationId: null,
      });

      expect(Object.keys(result)).toEqual(['user-1', 'user-2']);
      expect(result['user-1'].targetUserId).toBe('user-1');
      expect(result['user-2'].targetUserId).toBe('user-2');
      expect(result['user-1'].actions.ban).toBe(true);
      expect(result['user-2'].actions.ban).toBe(true);
    });

    it('skips users whose role lookup throws (ForbiddenException)', async () => {
      userRepo.findUserRole
        .mockResolvedValueOnce('member')
        .mockResolvedValueOnce(null);

      const result = await service.getBatchCapabilities({
        actorUserId: 'admin-1',
        userIds: ['user-1', 'ghost'],
        platformRole: 'admin',
        activeOrganizationId: null,
      });

      expect(Object.keys(result)).toEqual(['user-1']);
      expect(result['ghost']).toBeUndefined();
    });

    it('applies org scoping for manager role', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('member');
      userRepo.findMemberInOrg.mockResolvedValueOnce({ id: 'member-row' });

      const result = await service.getBatchCapabilities({
        actorUserId: 'manager-1',
        userIds: ['member-1'],
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
      });

      expect(result['member-1'].actions.ban).toBe(true);
      expect(userRepo.findMemberInOrg).toHaveBeenCalledWith(
        'member-1',
        'org-1',
      );
    });

    it('returns self capabilities correctly in batch for superadmin', async () => {
      userRepo.findUserRole.mockResolvedValueOnce('admin');

      const result = await service.getBatchCapabilities({
        actorUserId: 'superadmin-1',
        userIds: ['superadmin-1'],
        platformRole: 'superadmin',
        activeOrganizationId: null,
      });

      expect(result['superadmin-1'].isSelf).toBe(true);
      expect(result['superadmin-1'].actions.update).toBe(true);
      expect(result['superadmin-1'].actions.setRole).toBe(false);
    });
  });
});
