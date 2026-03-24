import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrgImpersonationService } from './org-impersonation.service';
import { DatabaseService } from '../../../../../shared/infrastructure/database/database.module';

describe('OrgImpersonationService', () => {
  let service: OrgImpersonationService;
  let dbService: jest.Mocked<DatabaseService>;

  const mockMembership = {
    id: 'member-1',
    userId: 'user-1',
    organizationId: 'org-1',
    role: 'admin',
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const mockDbService = {
      query: jest.fn(),
      queryOne: jest.fn(),
      transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgImpersonationService,
        { provide: DatabaseService, useValue: mockDbService },
      ],
    }).compile();

    service = module.get<OrgImpersonationService>(OrgImpersonationService);
    dbService = module.get(DatabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getMembership', () => {
    it('should return membership when exists', async () => {
      dbService.queryOne.mockResolvedValue(mockMembership);

      const result = await service.getMembership('user-1', 'org-1');

      expect(result).not.toBeNull();
      expect(result?.userId).toBe('user-1');
      expect(result?.role).toBe('admin');
    });

    it('should return null when membership does not exist', async () => {
      dbService.queryOne.mockResolvedValue(null);

      const result = await service.getMembership('user-1', 'org-1');

      expect(result).toBeNull();
    });
  });

  describe('canImpersonate', () => {
    it('should return true for admin role', () => {
      expect(service.canImpersonate('admin')).toBe(true);
    });

    it('should return true for manager role', () => {
      expect(service.canImpersonate('manager')).toBe(true);
    });

    it('should return false for member role', () => {
      expect(service.canImpersonate('member')).toBe(false);
    });
  });

  describe('impersonateUser', () => {
    it('should allow manager to impersonate member in same org', async () => {
      const impersonatorMembership = { ...mockMembership, userId: 'manager-1', role: 'admin' };
      const targetMembership = { ...mockMembership, userId: 'user-1', role: 'member' };

      dbService.queryOne
        .mockResolvedValueOnce(impersonatorMembership)
        .mockResolvedValueOnce(targetMembership);
      dbService.query.mockResolvedValue([]);

      const result = await service.impersonateUser('manager-1', 'user-1', 'org-1');

      expect(result.sessionToken).toBeDefined();
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO session'),
        expect.arrayContaining(['user-1', 'manager-1', 'org-1']),
      );
    });

    it('should use camelCase column names in INSERT query', async () => {
      const impersonatorMembership = { ...mockMembership, userId: 'manager-1', role: 'admin' };
      const targetMembership = { ...mockMembership, userId: 'user-1', role: 'member' };

      dbService.queryOne
        .mockResolvedValueOnce(impersonatorMembership)
        .mockResolvedValueOnce(targetMembership);
      dbService.query.mockResolvedValue([]);

      await service.impersonateUser('manager-1', 'user-1', 'org-1');

      const insertCall = dbService.query.mock.calls[0][0] as string;
      expect(insertCall).toContain('"userId"');
      expect(insertCall).toContain('"expiresAt"');
      expect(insertCall).toContain('"impersonatedBy"');
      expect(insertCall).toContain('"activeOrganizationId"');
      expect(insertCall).toContain('"createdAt"');
      expect(insertCall).toContain('"updatedAt"');
    });

    it('should deny impersonation if impersonator is not a member', async () => {
      dbService.queryOne.mockResolvedValue(null);

      await expect(
        service.impersonateUser('manager-1', 'user-1', 'org-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should deny impersonation if impersonator lacks manager role', async () => {
      const memberMembership = { ...mockMembership, role: 'member' };
      dbService.queryOne.mockResolvedValue(memberMembership);

      await expect(
        service.impersonateUser('member-1', 'user-1', 'org-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should deny impersonation if target is not in org', async () => {
      const impersonatorMembership = { ...mockMembership, role: 'admin' };
      dbService.queryOne
        .mockResolvedValueOnce(impersonatorMembership)
        .mockResolvedValueOnce(null);

      await expect(
        service.impersonateUser('manager-1', 'user-1', 'org-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should deny self-impersonation', async () => {
      const membership = { ...mockMembership, userId: 'user-1', role: 'admin' };
      dbService.queryOne
        .mockResolvedValueOnce(membership)
        .mockResolvedValueOnce(membership);

      await expect(
        service.impersonateUser('user-1', 'user-1', 'org-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('startImpersonation', () => {
    it('should allow superadmin to impersonate a non-admin target when explicit organizationId is valid', async () => {
      dbService.queryOne
        .mockResolvedValueOnce({ role: 'member' })
        .mockResolvedValueOnce({ id: 'member-1' });
      dbService.query.mockResolvedValue([]);

      const result = await (service as any).startImpersonation({
        actorUserId: 'superadmin-1',
        targetUserId: 'user-1',
        platformRole: 'superadmin',
        activeOrganizationId: null,
        organizationId: 'org-1',
      });

      expect(result.sessionToken).toBeDefined();
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO session'),
        expect.arrayContaining(['user-1', 'superadmin-1', 'org-1']),
      );
    });

    it('should allow admin to impersonate a non-admin target when explicit organizationId is valid', async () => {
      dbService.queryOne
        .mockResolvedValueOnce({ role: 'member' })
        .mockResolvedValueOnce({ id: 'member-1' });
      dbService.query.mockResolvedValue([]);

      const result = await (service as any).startImpersonation({
        actorUserId: 'admin-1',
        targetUserId: 'user-1',
        platformRole: 'admin',
        activeOrganizationId: null,
        organizationId: 'org-1',
      });

      expect(result.sessionToken).toBeDefined();
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO session'),
        expect.arrayContaining(['user-1', 'admin-1', 'org-1']),
      );
    });

    it('should deny admin self-impersonation', async () => {
      await expect(
        (service as any).startImpersonation({
          actorUserId: 'admin-1',
          targetUserId: 'admin-1',
          platformRole: 'admin',
          activeOrganizationId: null,
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(dbService.queryOne).not.toHaveBeenCalled();
    });

    it('should deny admin impersonation of another admin', async () => {
      dbService.queryOne.mockResolvedValueOnce({ role: 'admin' });

      await expect(
        (service as any).startImpersonation({
          actorUserId: 'admin-1',
          targetUserId: 'admin-2',
          platformRole: 'admin',
          activeOrganizationId: null,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow superadmin to impersonate an admin target when explicit organizationId is valid', async () => {
      dbService.queryOne
        .mockResolvedValueOnce({ role: 'admin' })
        .mockResolvedValueOnce({ id: 'member-1' });
      dbService.query.mockResolvedValue([]);

      const result = await (service as any).startImpersonation({
        actorUserId: 'superadmin-1',
        targetUserId: 'admin-2',
        platformRole: 'superadmin',
        activeOrganizationId: null,
        organizationId: 'org-1',
      });

      expect(result.sessionToken).toBeDefined();
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO session'),
        expect.arrayContaining(['admin-2', 'superadmin-1', 'org-1']),
      );
    });

    it('should allow manager to impersonate member in active org', async () => {
      dbService.queryOne
        .mockResolvedValueOnce({ role: 'member' })
        .mockResolvedValueOnce({ id: 'member-1' });
      dbService.query.mockResolvedValue([]);

      const result = await (service as any).startImpersonation({
        actorUserId: 'manager-1',
        targetUserId: 'user-1',
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
      });

      expect(result.sessionToken).toBeDefined();
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO session'),
        expect.arrayContaining(['user-1', 'manager-1', 'org-1']),
      );
    });

    it('should deny manager impersonation when target is outside active org', async () => {
      dbService.queryOne
        .mockResolvedValueOnce({ role: 'member' })
        .mockResolvedValueOnce(null);

      await expect(
        (service as any).startImpersonation({
          actorUserId: 'manager-1',
          targetUserId: 'user-2',
          platformRole: 'manager',
          activeOrganizationId: 'org-1',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should default to the first target organization for superadmin when organizationId is omitted for a multi-org target', async () => {
      dbService.queryOne.mockResolvedValueOnce({ role: 'member' });
      dbService.query
        .mockResolvedValueOnce([
          { organizationId: 'org-2' },
          { organizationId: 'org-1' },
        ])
        .mockResolvedValueOnce([]);

      const result = await (service as any).startImpersonation({
        actorUserId: 'superadmin-1',
        targetUserId: 'user-1',
        platformRole: 'superadmin',
        activeOrganizationId: null,
      });

      expect(result.sessionToken).toBeDefined();
      expect(dbService.query).toHaveBeenLastCalledWith(
        expect.stringContaining('INSERT INTO session'),
        expect.arrayContaining(['user-1', 'superadmin-1', 'org-1']),
      );
    });

    it('should use admin active organization for multi-org target when target belongs to the active org', async () => {
      dbService.queryOne
        .mockResolvedValueOnce({ role: 'member' })
        .mockResolvedValueOnce({ id: 'member-1' });
      dbService.query.mockResolvedValue([]);

      const result = await (service as any).startImpersonation({
        actorUserId: 'admin-1',
        targetUserId: 'user-1',
        platformRole: 'admin',
        activeOrganizationId: 'org-2',
      });

      expect(result.sessionToken).toBeDefined();
      expect(dbService.query).toHaveBeenLastCalledWith(
        expect.stringContaining('INSERT INTO session'),
        expect.arrayContaining(['user-1', 'admin-1', 'org-2']),
      );
    });

    it('should derive organizationId automatically for admin when target belongs to exactly one org', async () => {
      dbService.queryOne.mockResolvedValueOnce({ role: 'member' });
      dbService.query
        .mockResolvedValueOnce([{ organizationId: 'org-1' }])
        .mockResolvedValueOnce([]);

      const result = await (service as any).startImpersonation({
        actorUserId: 'admin-1',
        targetUserId: 'user-1',
        platformRole: 'admin',
        activeOrganizationId: null,
      });

      expect(result.sessionToken).toBeDefined();
      expect(dbService.query).toHaveBeenLastCalledWith(
        expect.stringContaining('INSERT INTO session'),
        expect.arrayContaining(['user-1', 'admin-1', 'org-1']),
      );
    });

    it('should derive organizationId automatically for admin when duplicate membership rows belong to the same org', async () => {
      dbService.queryOne.mockResolvedValueOnce({ role: 'member' });
      dbService.query
        .mockResolvedValueOnce([
          { organizationId: 'org-1' },
          { organizationId: 'org-1' },
        ])
        .mockResolvedValueOnce([]);

      const result = await (service as any).startImpersonation({
        actorUserId: 'admin-1',
        targetUserId: 'user-1',
        platformRole: 'admin',
        activeOrganizationId: null,
      });

      expect(result.sessionToken).toBeDefined();
      expect(dbService.query).toHaveBeenLastCalledWith(
        expect.stringContaining('INSERT INTO session'),
        expect.arrayContaining(['user-1', 'admin-1', 'org-1']),
      );
    });
  });

  describe('stopImpersonation', () => {
    it('should delete impersonation session', async () => {
      dbService.queryOne.mockResolvedValue({ id: 'session-1', impersonatedBy: 'manager-1' });
      dbService.query.mockResolvedValue([]);

      await service.stopImpersonation('token-123');

      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM session'),
        ['token-123'],
      );
    });

    it('should throw if session not found', async () => {
      dbService.queryOne.mockResolvedValue(null);

      await expect(service.stopImpersonation('invalid-token')).rejects.toThrow(NotFoundException);
    });

    it('should use camelCase column names in SELECT query', async () => {
      dbService.queryOne.mockResolvedValue({ id: 'session-1', impersonatedBy: 'manager-1' });
      dbService.query.mockResolvedValue([]);

      await service.stopImpersonation('token-123');

      const selectCall = dbService.queryOne.mock.calls[0][0] as string;
      expect(selectCall).toContain('"impersonatedBy"');
    });

    it('should throw if session is not an impersonation session', async () => {
      dbService.queryOne.mockResolvedValue({ id: 'session-1', impersonatedBy: null });

      await expect(service.stopImpersonation('token-123')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('startImpersonation (additional branch coverage)', () => {
    it('should throw NotFoundException when target user is not found in the database', async () => {
      dbService.queryOne.mockResolvedValueOnce(null); // target user not found

      await expect(
        (service as any).startImpersonation({
          actorUserId: 'admin-1',
          targetUserId: 'ghost-user',
          platformRole: 'admin',
          activeOrganizationId: null,
          organizationId: 'org-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when superadmin target has no membership in the specified org', async () => {
      dbService.queryOne
        .mockResolvedValueOnce({ role: 'member' }) // target user found
        .mockResolvedValueOnce(null);              // no membership in specified org

      await expect(
        (service as any).startImpersonation({
          actorUserId: 'superadmin-1',
          targetUserId: 'user-1',
          platformRole: 'superadmin',
          activeOrganizationId: null,
          organizationId: 'org-1',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when target user has no organization memberships', async () => {
      dbService.queryOne.mockResolvedValueOnce({ role: 'member' }); // target user found
      dbService.query.mockResolvedValueOnce([]);                     // no memberships

      await expect(
        (service as any).startImpersonation({
          actorUserId: 'superadmin-1',
          targetUserId: 'user-1',
          platformRole: 'superadmin',
          activeOrganizationId: null,
          // organizationId not provided
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException when org-scoped actor has no active organization', async () => {
      dbService.queryOne.mockResolvedValueOnce({ role: 'member' }); // target user found

      await expect(
        (service as any).startImpersonation({
          actorUserId: 'manager-1',
          targetUserId: 'user-1',
          platformRole: 'manager',
          activeOrganizationId: null,
          // no organizationId → managerOrganizationId = null
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when organizationId differs from activeOrganizationId', async () => {
      dbService.queryOne.mockResolvedValueOnce({ role: 'member' }); // target user found

      await expect(
        (service as any).startImpersonation({
          actorUserId: 'manager-1',
          targetUserId: 'user-1',
          platformRole: 'manager',
          activeOrganizationId: 'org-1',
          organizationId: 'org-2', // mismatched with activeOrganizationId
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when org-scoped actor tries to impersonate a non-member role', async () => {
      dbService.queryOne.mockResolvedValueOnce({ role: 'admin' }); // target has admin role, not member

      await expect(
        (service as any).startImpersonation({
          actorUserId: 'manager-1',
          targetUserId: 'admin-2',
          platformRole: 'manager',
          activeOrganizationId: 'org-1',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
