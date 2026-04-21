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

import { ForbiddenException } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

describe('DashboardController', () => {
  let controller: DashboardController;
  let service: jest.Mocked<DashboardService>;

  const superadminSession = {
    user: { id: 'user-super', role: 'superadmin' },
    session: {},
  } as any;

  const managerSession = {
    user: { id: 'user-mgr', role: 'manager' },
    session: { activeOrganizationId: 'org-1' },
  } as any;

  const memberSession = {
    user: { id: 'user-member', role: 'member' },
    session: { activeOrganizationId: 'org-1' },
  } as any;

  const mockOrgs = [{ id: 'org-1', name: 'Org 1', slug: 'org-1' }];
  const mockOverview = {
    totalUsers: 10,
    bannedUsers: 1,
    activeSessions: 5,
    totalOrganizations: 2,
    totalConversations: 50,
    totalMessages: 200,
    assistantMessages: 100,
    totalTokensAllTime: 5000,
  };
  const mockUserStats = {
    total: 10,
    newInRange: 2,
    bannedCount: 1,
    emailVerifiedCount: 8,
    timeSeriesNewUsers: [],
    topUsers: [],
    activeSessions: 5,
    expiredSessions: 2,
    impersonatedSessions: 0,
    sessionsByBrowser: [],
  };
  const mockChatStats = {
    totalConversations: 20,
    totalMessages: 100,
    assistantMessages: 60,
    userMessages: 40,
    avgMessagesPerConversation: 5,
    activeConversationsInRange: 15,
    timeSeriesConversations: [],
    timeSeriesMessages: [],
    generatorDistribution: [],
    sourceIntegrationUsage: [],
    entityTypeBreakdown: [],
    avgToolCallsPerResponse: null,
    avgResultsPerResponse: null,
    totalTokens: null,
    totalPromptTokens: null,
    totalCompletionTokens: null,
    avgTokensPerResponse: null,
    messagesWithTokenData: 0,
  };
  const mockOrgStats = {
    totalOrganizations: 2,
    pendingInvitations: 3,
    conversationsPerOrg: [],
    membersPerOrg: [],
    memberRoleDistribution: [],
    mostActiveOrgs: [],
  };

  beforeEach(() => {
    service = {
      getAvailableOrganizations: jest.fn(),
      validateOrgAccess: jest.fn(),
      getOverview: jest.fn(),
      getUserStats: jest.fn(),
      getChatStats: jest.fn(),
      getOrgStats: jest.fn(),
    } as unknown as jest.Mocked<DashboardService>;

    controller = new DashboardController(service);
  });

  // ─── getAvailableOrganizations ───────────────────────────────────────────────

  describe('getAvailableOrganizations', () => {
    it('returns orgs for superadmin (isSuperadmin=true)', async () => {
      service.getAvailableOrganizations.mockResolvedValue(mockOrgs);

      const result =
        await controller.getAvailableOrganizations(superadminSession);

      expect(service.getAvailableOrganizations).toHaveBeenCalledWith(
        'user-super',
        true,
      );
      expect(result).toEqual(mockOrgs);
    });

    it('returns orgs for manager (isSuperadmin=false)', async () => {
      service.getAvailableOrganizations.mockResolvedValue(mockOrgs);

      const result = await controller.getAvailableOrganizations(managerSession);

      expect(service.getAvailableOrganizations).toHaveBeenCalledWith(
        'user-mgr',
        false,
      );
      expect(result).toEqual(mockOrgs);
    });
  });

  // ─── getOverview ─────────────────────────────────────────────────────────────

  describe('getOverview', () => {
    it('returns overview without organizationId (global scope)', async () => {
      service.getOverview.mockResolvedValue(mockOverview);

      const result = await controller.getOverview(superadminSession);

      expect(service.getOverview).toHaveBeenCalledWith(null);
      expect(result).toEqual(mockOverview);
    });

    it('returns overview scoped to organization for superadmin', async () => {
      service.getOverview.mockResolvedValue(mockOverview);

      const result = await controller.getOverview(superadminSession, 'org-1');

      expect(service.getOverview).toHaveBeenCalledWith('org-1');
      expect(result).toEqual(mockOverview);
    });

    it('validates org access for non-superadmin and returns scoped overview', async () => {
      service.validateOrgAccess.mockResolvedValue(true);
      service.getOverview.mockResolvedValue(mockOverview);

      const result = await controller.getOverview(managerSession, 'org-1');

      expect(service.validateOrgAccess).toHaveBeenCalledWith(
        'user-mgr',
        'org-1',
      );
      expect(service.getOverview).toHaveBeenCalledWith('org-1');
      expect(result).toEqual(mockOverview);
    });

    it('throws ForbiddenException when non-superadmin lacks org access', async () => {
      service.validateOrgAccess.mockResolvedValue(false);

      await expect(
        controller.getOverview(managerSession, 'org-2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ─── getUserStats ────────────────────────────────────────────────────────────

  describe('getUserStats', () => {
    it('returns user stats with default 30d range', async () => {
      service.getUserStats.mockResolvedValue(mockUserStats);

      const result = await controller.getUserStats(superadminSession);

      expect(service.getUserStats).toHaveBeenCalledWith('30d', null);
      expect(result).toEqual(mockUserStats);
    });

    it('returns user stats with explicit range and org', async () => {
      service.validateOrgAccess.mockResolvedValue(true);
      service.getUserStats.mockResolvedValue(mockUserStats);

      const result = await controller.getUserStats(
        managerSession,
        '7d',
        'org-1',
      );

      expect(service.validateOrgAccess).toHaveBeenCalledWith(
        'user-mgr',
        'org-1',
      );
      expect(service.getUserStats).toHaveBeenCalledWith('7d', 'org-1');
      expect(result).toEqual(mockUserStats);
    });
  });

  // ─── getChatStats ────────────────────────────────────────────────────────────

  describe('getChatStats', () => {
    it('returns chat stats with default 30d range', async () => {
      service.getChatStats.mockResolvedValue(mockChatStats);

      const result = await controller.getChatStats(superadminSession);

      expect(service.getChatStats).toHaveBeenCalledWith('30d', null);
      expect(result).toEqual(mockChatStats);
    });

    it('returns chat stats scoped to org for non-superadmin', async () => {
      service.validateOrgAccess.mockResolvedValue(true);
      service.getChatStats.mockResolvedValue(mockChatStats);

      const result = await controller.getChatStats(
        memberSession,
        '90d',
        'org-1',
      );

      expect(service.getChatStats).toHaveBeenCalledWith('90d', 'org-1');
      expect(result).toEqual(mockChatStats);
    });
  });

  // ─── getOrgStats ─────────────────────────────────────────────────────────────

  describe('getOrgStats', () => {
    it('returns org stats without organizationId (global)', async () => {
      service.getOrgStats.mockResolvedValue(mockOrgStats);

      const result = await controller.getOrgStats(superadminSession);

      expect(service.getOrgStats).toHaveBeenCalledWith(null);
      expect(result).toEqual(mockOrgStats);
    });

    it('returns org stats scoped to organization', async () => {
      service.validateOrgAccess.mockResolvedValue(true);
      service.getOrgStats.mockResolvedValue(mockOrgStats);

      const result = await controller.getOrgStats(managerSession, 'org-1');

      expect(service.getOrgStats).toHaveBeenCalledWith('org-1');
      expect(result).toEqual(mockOrgStats);
    });
  });

  // ─── resolveOrgAccess private method via all endpoints ──────────────────────

  describe('resolveOrgAccess edge cases', () => {
    it('does not call validateOrgAccess for superadmin even with organizationId', async () => {
      service.getOverview.mockResolvedValue(mockOverview);

      await controller.getOverview(superadminSession, 'org-1');

      expect(service.validateOrgAccess).not.toHaveBeenCalled();
    });

    it('returns null scopedOrgId when no organizationId is passed', async () => {
      service.getChatStats.mockResolvedValue(mockChatStats);

      await controller.getChatStats(superadminSession, '30d', undefined);

      expect(service.getChatStats).toHaveBeenCalledWith('30d', null);
    });
  });
});
