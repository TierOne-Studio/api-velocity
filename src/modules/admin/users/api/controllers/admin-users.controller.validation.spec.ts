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

import { HttpStatus } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller';
import { AdminService } from '../../application/services';
import { OrgImpersonationService } from '../../../organizations/application/services';

describe('AdminUsersController validation', () => {
  let controller: AdminUsersController;
  let adminService: jest.Mocked<AdminService>;
  let impersonationService: jest.Mocked<OrgImpersonationService>;

  const baseSession = {
    user: { id: 'actor-admin', role: 'admin' },
    session: {},
  } as any;

  beforeEach(() => {
    adminService = {
      getCreateUserMetadata: jest.fn(),
      getUserCapabilities: jest.fn(),
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

  it('rejects list when limit is not a number', async () => {
    await expect(controller.list(baseSession, 'abc', '0')).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects list when offset is negative', async () => {
    await expect(controller.list(baseSession, '10', '-1')).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects create when required fields are missing', async () => {
    await expect(
      controller.create(baseSession, {
        name: '',
        email: '',
        password: '',
        role: 'member',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects create when role is invalid', async () => {
    await expect(
      controller.create(baseSession, {
        name: 'User',
        email: 'user@example.com',
        password: 'Password123!',
        role: 'owner' as 'admin' | 'manager' | 'member',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects create for non-admin role without organizationId', async () => {
    await expect(
      controller.create(baseSession, {
        name: 'User',
        email: 'user@example.com',
        password: 'Password123!',
        role: 'member',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects setRole when role is invalid', async () => {
    await expect(
      controller.setRole(baseSession, 'target-user', {
        role: 'owner' as 'admin' | 'manager' | 'member',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects setPassword when password is shorter than 8 chars', async () => {
    await expect(
      controller.setPassword(baseSession, 'target-user', { newPassword: 'short' }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects bulkRemove when userIds is not an array', async () => {
    await expect(
      controller.bulkRemove(baseSession, { userIds: undefined as unknown as string[] }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

});
