import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { DatabaseService } from '../../../shared/infrastructure/database/database.module';

describe('DashboardService', () => {
  let service: DashboardService;
  let db: {
    query: jest.Mock<any>;
    queryOne: jest.Mock<any>;
  };

  beforeEach(async () => {
    db = {
      query: jest.fn(),
      queryOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [DashboardService, { provide: DatabaseService, useValue: db }],
    }).compile();

    service = module.get(DashboardService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── getAvailableOrganizations ───────────────────────────────────────────────

  describe('getAvailableOrganizations', () => {
    it('returns all orgs for superadmin (no userId filter)', async () => {
      const orgs = [{ id: 'org-1', name: 'Org 1', slug: 'org-1' }];
      db.query.mockResolvedValue(orgs);

      const result = await service.getAvailableOrganizations('user-1', true);

      expect(result).toEqual(orgs);
      const [sql] = db.query.mock.calls[0] as [string, unknown[]?];
      expect(sql).toContain('FROM organization');
      expect(sql).not.toContain('member');
    });

    it('returns only orgs the user belongs to when not superadmin', async () => {
      const orgs = [{ id: 'org-1', name: 'Org 1', slug: 'org-1' }];
      db.query.mockResolvedValue(orgs);

      const result = await service.getAvailableOrganizations('user-1', false);

      expect(result).toEqual(orgs);
      const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('JOIN member');
      expect(params).toContain('user-1');
    });
  });

  // ─── validateOrgAccess ───────────────────────────────────────────────────────

  describe('validateOrgAccess', () => {
    it('returns true when membership exists', async () => {
      db.queryOne.mockResolvedValue({ id: 'mem-1' });

      const result = await service.validateOrgAccess('user-1', 'org-1');

      expect(result).toBe(true);
    });

    it('returns false when no membership found', async () => {
      db.queryOne.mockResolvedValue(null);

      const result = await service.validateOrgAccess('user-1', 'org-1');

      expect(result).toBe(false);
    });
  });

  // ─── getOverview ─────────────────────────────────────────────────────────────

  describe('getOverview', () => {
    it('returns parsed overview stats for global scope (no organizationId)', async () => {
      db.queryOne
        .mockResolvedValueOnce({ total: '10', banned: '2' }) // users
        .mockResolvedValueOnce({ active: '5' }) // sessions
        .mockResolvedValueOnce({ total: '3' }) // orgs
        .mockResolvedValueOnce({ total: '50' }) // conversations
        .mockResolvedValueOnce({ total: '200', assistant: '100' }) // messages
        .mockResolvedValueOnce({ total_tokens: '5000' }); // token stats

      const result = await service.getOverview();

      expect(result.totalUsers).toBe(10);
      expect(result.bannedUsers).toBe(2);
      expect(result.activeSessions).toBe(5);
      expect(result.totalOrganizations).toBe(3);
      expect(result.totalConversations).toBe(50);
      expect(result.totalMessages).toBe(200);
      expect(result.assistantMessages).toBe(100);
      expect(result.totalTokensAllTime).toBe(5000);
    });

    it('returns overview stats scoped to an organization', async () => {
      db.queryOne
        .mockResolvedValueOnce({ total: '4', banned: '1' }) // users
        .mockResolvedValueOnce({ active: '2' }) // sessions
        // orgs: Promise.resolve({ total: '1' }) is used inline — queryOne not called
        .mockResolvedValueOnce({ total: '20' }) // conversations
        .mockResolvedValueOnce({ total: '80', assistant: '40' }) // messages
        .mockResolvedValueOnce({ total_tokens: null }); // token stats

      const result = await service.getOverview('org-1');

      expect(result.totalUsers).toBe(4);
      expect(result.totalOrganizations).toBe(1);
      expect(result.totalTokensAllTime).toBeNull();
    });

    it('handles null queryOne responses gracefully with default 0 values', async () => {
      db.queryOne.mockResolvedValue(null);

      const result = await service.getOverview();

      expect(result.totalUsers).toBe(0);
      expect(result.bannedUsers).toBe(0);
      expect(result.activeSessions).toBe(0);
      expect(result.totalConversations).toBe(0);
      expect(result.totalMessages).toBe(0);
      expect(result.assistantMessages).toBe(0);
      expect(result.totalTokensAllTime).toBeNull();
    });
  });

  // ─── getUserStats ────────────────────────────────────────────────────────────

  describe('getUserStats', () => {
    const baseTopUser = {
      user_id: 'user-1',
      name: 'Alice',
      email: 'alice@example.com',
      role: 'member',
      conversation_count: 5,
      message_count: 20,
      organization_count: 1,
      last_active_at: '2026-04-03T00:00:00.000Z',
    };

    it('returns user stats for global scope with 30d range', async () => {
      db.queryOne
        .mockResolvedValueOnce({
          total: '50',
          new_in_range: '10',
          banned_count: '2',
          email_verified_count: '40',
        })
        .mockResolvedValueOnce({
          active: '5',
          expired: '3',
          impersonated: '1',
        });

      db.query
        .mockResolvedValueOnce([{ date: '2026-04-01', count: '5' }]) // timeSeries
        .mockResolvedValueOnce([baseTopUser]) // topUsers
        .mockResolvedValueOnce([{ browser: 'Chrome', count: '3' }]); // sessionsByBrowser

      const result = await service.getUserStats('30d');

      expect(result.total).toBe(50);
      expect(result.newInRange).toBe(10);
      expect(result.bannedCount).toBe(2);
      expect(result.emailVerifiedCount).toBe(40);
      expect(result.timeSeriesNewUsers).toHaveLength(1);
      expect(result.topUsers[0].userId).toBe('user-1');
      expect(result.topUsers[0].lastActiveAt).toBeTruthy();
      expect(result.activeSessions).toBe(5);
      expect(result.expiredSessions).toBe(3);
      expect(result.impersonatedSessions).toBe(1);
      expect(result.sessionsByBrowser).toHaveLength(1);
    });

    it('returns user stats scoped to organization', async () => {
      db.queryOne
        .mockResolvedValueOnce({
          total: '10',
          new_in_range: '2',
          banned_count: '0',
          email_verified_count: '8',
        })
        .mockResolvedValueOnce({
          active: '2',
          expired: '1',
          impersonated: '0',
        });

      db.query
        .mockResolvedValueOnce([]) // timeSeries
        .mockResolvedValueOnce([]) // topUsers
        .mockResolvedValueOnce([]); // sessionsByBrowser

      const result = await service.getUserStats('7d', 'org-1');

      expect(result.total).toBe(10);
    });

    it('handles null last_active_at on top users', async () => {
      db.queryOne
        .mockResolvedValueOnce({
          total: '1',
          new_in_range: '1',
          banned_count: '0',
          email_verified_count: '1',
        })
        .mockResolvedValueOnce({
          active: '0',
          expired: '0',
          impersonated: '0',
        });

      db.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ ...baseTopUser, last_active_at: null }])
        .mockResolvedValueOnce([]);

      const result = await service.getUserStats('90d');

      expect(result.topUsers[0].lastActiveAt).toBeNull();
    });

    it('handles null totals gracefully', async () => {
      db.queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      db.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getUserStats('7d');

      expect(result.total).toBe(0);
      expect(result.activeSessions).toBe(0);
    });
  });

  // ─── getChatStats ────────────────────────────────────────────────────────────

  describe('getChatStats', () => {
    it('returns chat stats for global scope', async () => {
      db.queryOne
        .mockResolvedValueOnce({
          total_conversations: '20',
          total_messages: '100',
          avg_messages: '5.5',
          active_in_range: '15',
        })
        .mockResolvedValueOnce({
          avg_tool_calls: '2.5',
          avg_results: '3.0',
        })
        .mockResolvedValueOnce({
          total_tokens: '10000',
          total_prompt_tokens: '6000',
          total_completion_tokens: '4000',
          avg_tokens: '500',
          messages_with_token_data: '20',
        });

      db.query
        .mockResolvedValueOnce([
          { role: 'assistant', count: '60' },
          { role: 'user', count: '40' },
        ]) // roleCounts
        .mockResolvedValueOnce([{ date: '2026-04-01', count: '5' }]) // timeSeriesConversations
        .mockResolvedValueOnce([
          { date: '2026-04-01', user_count: '10', assistant_count: '15' },
        ]) // timeSeriesMessages
        .mockResolvedValueOnce([
          { generator: 'claude-3', count: '60' },
          { generator: 'fallback', count: '40' },
        ]) // generatorDist
        .mockResolvedValueOnce([{ source_name: 'github', count: '30' }]) // sourceUsage
        .mockResolvedValueOnce([{ entity_type: 'file', count: '20' }]); // entityBreakdown

      const result = await service.getChatStats('30d');

      expect(result.totalConversations).toBe(20);
      expect(result.totalMessages).toBe(100);
      expect(result.assistantMessages).toBe(60);
      expect(result.userMessages).toBe(40);
      expect(result.avgMessagesPerConversation).toBe(5.5);
      expect(result.activeConversationsInRange).toBe(15);
      expect(result.generatorDistribution).toHaveLength(2);
      expect(result.generatorDistribution[0].percentage).toBe(60);
      expect(result.avgToolCallsPerResponse).toBe(2.5);
      expect(result.totalTokens).toBe(10000);
      expect(result.messagesWithTokenData).toBe(20);
    });

    it('returns chat stats scoped to organization', async () => {
      db.queryOne
        .mockResolvedValueOnce({
          total_conversations: '5',
          total_messages: '25',
          avg_messages: '5',
          active_in_range: '3',
        })
        .mockResolvedValueOnce({ avg_tool_calls: null, avg_results: null })
        .mockResolvedValueOnce({
          total_tokens: null,
          total_prompt_tokens: null,
          total_completion_tokens: null,
          avg_tokens: null,
          messages_with_token_data: '0',
        });

      db.query
        .mockResolvedValueOnce([]) // roleCounts
        .mockResolvedValueOnce([]) // timeSeriesConversations
        .mockResolvedValueOnce([]) // timeSeriesMessages
        .mockResolvedValueOnce([]) // generatorDist
        .mockResolvedValueOnce([]) // sourceUsage
        .mockResolvedValueOnce([]); // entityBreakdown

      const result = await service.getChatStats('7d', 'org-1');

      expect(result.totalConversations).toBe(5);
      expect(result.avgToolCallsPerResponse).toBeNull();
      expect(result.totalTokens).toBeNull();
    });

    it('handles empty role counts and null totals', async () => {
      db.queryOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      db.query
        .mockResolvedValueOnce([]) // roleCounts
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getChatStats('30d');

      expect(result.totalConversations).toBe(0);
      expect(result.assistantMessages).toBe(0);
      expect(result.avgToolCallsPerResponse).toBeNull();
      expect(result.totalTokens).toBeNull();
      expect(result.generatorDistribution).toHaveLength(0);
    });

    it('computes generator distribution percentages correctly when totalGeneratorCount is 0', async () => {
      db.queryOne
        .mockResolvedValueOnce({
          total_conversations: '0',
          total_messages: '0',
          avg_messages: '0',
          active_in_range: '0',
        })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      db.query
        .mockResolvedValueOnce([]) // roleCounts (empty — total=0)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ generator: 'unknown', count: '0' }]) // all zero
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getChatStats('30d');

      expect(result.generatorDistribution[0].percentage).toBe(0);
    });
  });

  // ─── getOrgStats ─────────────────────────────────────────────────────────────

  describe('getOrgStats', () => {
    it('returns org stats for global scope', async () => {
      db.queryOne
        .mockResolvedValueOnce({ total: '5' }) // totalOrgs
        .mockResolvedValueOnce({ count: '10' }); // pendingInvitations

      db.query
        .mockResolvedValueOnce([
          {
            org_id: 'org-1',
            org_name: 'Org 1',
            conversation_count: '10',
            message_count: '50',
          },
        ]) // conversationsPerOrg
        .mockResolvedValueOnce([
          { org_id: 'org-1', org_name: 'Org 1', member_count: '5' },
        ]) // membersPerOrg
        .mockResolvedValueOnce([
          { role: 'member', count: '4' },
          { role: 'admin', count: '1' },
        ]) // memberRoleDistribution
        .mockResolvedValueOnce([
          { org_id: 'org-1', org_name: 'Org 1', recent_message_count: '25' },
        ]); // mostActiveOrgs

      const result = await service.getOrgStats();

      expect(result.totalOrganizations).toBe(5);
      expect(result.pendingInvitations).toBe(10);
      expect(result.conversationsPerOrg).toHaveLength(1);
      expect(result.conversationsPerOrg[0].conversationCount).toBe(10);
      expect(result.membersPerOrg[0].memberCount).toBe(5);
      expect(result.memberRoleDistribution).toHaveLength(2);
      expect(result.mostActiveOrgs[0].recentMessageCount).toBe(25);
    });

    it('returns org stats scoped to organization (uses totalOrgs=1 inline)', async () => {
      db.queryOne
        // no totalOrgs call — Promise.resolve({ total: '1' }) is used inline
        .mockResolvedValueOnce({ count: '3' }); // pendingInvitations

      db.query
        .mockResolvedValueOnce([
          {
            org_id: 'org-1',
            org_name: 'Org 1',
            conversation_count: '5',
            message_count: '20',
          },
        ])
        .mockResolvedValueOnce([
          { org_id: 'org-1', org_name: 'Org 1', member_count: '3' },
        ])
        .mockResolvedValueOnce([{ role: 'member', count: '2' }])
        .mockResolvedValueOnce([
          { org_id: 'org-1', org_name: 'Org 1', recent_message_count: '12' },
        ]);

      const result = await service.getOrgStats('org-1');

      expect(result.totalOrganizations).toBe(1);
      expect(result.pendingInvitations).toBe(3);
    });

    it('handles null queryOne responses for org stats', async () => {
      db.queryOne.mockResolvedValue(null);

      db.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getOrgStats();

      expect(result.totalOrganizations).toBe(0);
      expect(result.pendingInvitations).toBe(0);
    });
  });
});
