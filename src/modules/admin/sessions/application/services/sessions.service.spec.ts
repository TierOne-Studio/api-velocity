import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import {
  ISessionRepository,
  SESSION_REPOSITORY,
} from '../../domain/repositories/session.repository.interface';

describe('SessionsService', () => {
  let service: SessionsService;
  let sessionRepo: jest.Mocked<ISessionRepository>;

  beforeEach(async () => {
    const mockRepo: jest.Mocked<ISessionRepository> = {
      findSessionByToken: jest.fn(),
      revokeSession: jest.fn(),
      revokeAllSessions: jest.fn(),
      listUserSessions: jest.fn(),
      findMemberInOrg: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: SESSION_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(SessionsService);
    sessionRepo = mockRepo;
  });

  describe('listUserSessions', () => {
    it('should list sessions for superadmin', async () => {
      const sessions = [
        { id: 's1', userId: 'u1', token: 't1', expiresAt: new Date(), createdAt: new Date(), updatedAt: new Date(), ipAddress: null, userAgent: null },
      ];
      sessionRepo.listUserSessions.mockResolvedValue(sessions);

      const result = await service.listUserSessions({ userId: 'u1', platformRole: 'superadmin', activeOrganizationId: null });
      expect(result).toEqual(sessions);
      expect(sessionRepo.listUserSessions).toHaveBeenCalledWith('u1');
    });

    it('should require active org for manager', async () => {
      await expect(
        service.listUserSessions({ userId: 'u1', platformRole: 'manager', activeOrganizationId: null }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should check user membership for manager', async () => {
      sessionRepo.findMemberInOrg.mockResolvedValue(null);
      await expect(
        service.listUserSessions({ userId: 'u1', platformRole: 'manager', activeOrganizationId: 'org1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow manager if user is in their org', async () => {
      sessionRepo.findMemberInOrg.mockResolvedValue({ id: 'm1' });
      sessionRepo.listUserSessions.mockResolvedValue([]);

      const result = await service.listUserSessions({ userId: 'u1', platformRole: 'manager', activeOrganizationId: 'org1' });
      expect(result).toEqual([]);
    });
  });

  describe('revokeSession', () => {
    it('should revoke session for superadmin', async () => {
      const result = await service.revokeSession({ sessionToken: 'token1' }, 'superadmin', null);
      expect(result).toEqual({ success: true });
      expect(sessionRepo.revokeSession).toHaveBeenCalledWith('token1');
    });

    it('should require active org for manager', async () => {
      await expect(
        service.revokeSession({ sessionToken: 'token1' }, 'manager', null),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should check session owner membership for manager', async () => {
      sessionRepo.findSessionByToken.mockResolvedValue({ userId: 'u1' });
      sessionRepo.findMemberInOrg.mockResolvedValue(null);

      await expect(
        service.revokeSession({ sessionToken: 'token1' }, 'manager', 'org1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return success if session not found for manager', async () => {
      sessionRepo.findSessionByToken.mockResolvedValue(null);
      const result = await service.revokeSession({ sessionToken: 'token1' }, 'manager', 'org1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('revokeAllSessions', () => {
    it('should revoke all sessions for superadmin', async () => {
      const result = await service.revokeAllSessions({ userId: 'u1' }, 'superadmin', null);
      expect(result).toEqual({ success: true });
      expect(sessionRepo.revokeAllSessions).toHaveBeenCalledWith('u1');
    });

    it('should require active org for manager', async () => {
      await expect(
        service.revokeAllSessions({ userId: 'u1' }, 'manager', null),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should check membership for manager', async () => {
      sessionRepo.findMemberInOrg.mockResolvedValue(null);
      await expect(
        service.revokeAllSessions({ userId: 'u1' }, 'manager', 'org1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
