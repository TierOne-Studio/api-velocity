import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../shared/infrastructure/database/database.module';
import { OverviewStatsDto } from './dto/overview-stats.dto';
import { UserStatsDto } from './dto/user-stats.dto';
import { ChatStatsDto } from './dto/chat-stats.dto';
import { OrgStatsDto } from './dto/org-stats.dto';

type Range = '7d' | '30d' | '90d';

const RANGE_INTERVAL: Record<Range, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
};

@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService) {}

  async getAvailableOrganizations(
    userId: string,
    isSuperadmin: boolean,
  ): Promise<Array<{ id: string; name: string; slug: string }>> {
    if (isSuperadmin) {
      return this.db.query<{ id: string; name: string; slug: string }>(
        `SELECT id, name, slug FROM organization ORDER BY name`,
      );
    }
    return this.db.query<{ id: string; name: string; slug: string }>(
      `SELECT o.id, o.name, o.slug
       FROM organization o
       JOIN member m ON m."organizationId" = o.id
       WHERE m."userId" = $1
       ORDER BY o.name`,
      [userId],
    );
  }

  async validateOrgAccess(userId: string, organizationId: string): Promise<boolean> {
    const membership = await this.db.queryOne(
      `SELECT id FROM member WHERE "userId" = $1 AND "organizationId" = $2`,
      [userId, organizationId],
    );
    return membership !== null;
  }

  async getOverview(organizationId?: string | null): Promise<OverviewStatsDto> {
    const [users, sessions, orgs, conversations, messages, tokenStats] =
      await Promise.all([
        organizationId
          ? this.db.queryOne<{ total: string; banned: string }>(
              `SELECT
                 COUNT(DISTINCT m."userId")::text AS total,
                 COUNT(DISTINCT CASE WHEN u.banned = true THEN m."userId" END)::text AS banned
               FROM member m
               JOIN "user" u ON u.id = m."userId"
               WHERE m."organizationId" = $1`,
              [organizationId],
            )
          : this.db.queryOne<{ total: string; banned: string }>(
              `SELECT
                 COUNT(*)::text AS total,
                 COUNT(*) FILTER (WHERE banned = true)::text AS banned
               FROM "user"`,
            ),
        organizationId
          ? this.db.queryOne<{ active: string }>(
              `SELECT COUNT(DISTINCT s.id)::text AS active
               FROM session s
               JOIN member m ON m."userId" = s."userId"
               WHERE m."organizationId" = $1 AND s."expiresAt" > NOW()`,
              [organizationId],
            )
          : this.db.queryOne<{ active: string }>(
              `SELECT COUNT(*)::text AS active FROM session WHERE "expiresAt" > NOW()`,
            ),
        organizationId
          ? Promise.resolve({ total: '1' } as { total: string })
          : this.db.queryOne<{ total: string }>(
              `SELECT COUNT(*)::text AS total FROM organization`,
            ),
        organizationId
          ? this.db.queryOne<{ total: string }>(
              `SELECT COUNT(*)::text AS total FROM conversation WHERE organization_id = $1`,
              [organizationId],
            )
          : this.db.queryOne<{ total: string }>(
              `SELECT COUNT(*)::text AS total FROM conversation`,
            ),
        organizationId
          ? this.db.queryOne<{ total: string; assistant: string }>(
              `SELECT
                 COUNT(*)::text AS total,
                 COUNT(*) FILTER (WHERE msg.role = 'assistant')::text AS assistant
               FROM message msg
               JOIN conversation c ON c.id = msg.conversation_id
               WHERE c.organization_id = $1`,
              [organizationId],
            )
          : this.db.queryOne<{ total: string; assistant: string }>(
              `SELECT
                 COUNT(*)::text AS total,
                 COUNT(*) FILTER (WHERE role = 'assistant')::text AS assistant
               FROM message`,
            ),
        organizationId
          ? this.db.queryOne<{ total_tokens: string | null }>(
              `SELECT SUM((msg.metadata->>'totalTokens')::int)::text AS total_tokens
               FROM message msg
               JOIN conversation c ON c.id = msg.conversation_id
               WHERE c.organization_id = $1 AND msg.role = 'assistant'
                 AND msg.metadata IS NOT NULL AND msg.metadata->>'totalTokens' IS NOT NULL`,
              [organizationId],
            )
          : this.db.queryOne<{ total_tokens: string | null }>(
              `SELECT SUM((metadata->>'totalTokens')::int)::text AS total_tokens
               FROM message
               WHERE role = 'assistant' AND metadata IS NOT NULL AND metadata->>'totalTokens' IS NOT NULL`,
            ),
      ]);

    return {
      totalUsers: parseInt(users?.total ?? '0', 10),
      bannedUsers: parseInt(users?.banned ?? '0', 10),
      activeSessions: parseInt(sessions?.active ?? '0', 10),
      totalOrganizations: parseInt(orgs?.total ?? '0', 10),
      totalConversations: parseInt(conversations?.total ?? '0', 10),
      totalMessages: parseInt(messages?.total ?? '0', 10),
      assistantMessages: parseInt(messages?.assistant ?? '0', 10),
      totalTokensAllTime: tokenStats?.total_tokens != null ? parseInt(tokenStats.total_tokens, 10) : null,
    };
  }

  async getUserStats(range: Range, organizationId?: string | null): Promise<UserStatsDto> {
    const interval = RANGE_INTERVAL[range];

    const [totals, timeSeries, topUsers, sessionTotals, sessionsByBrowser] =
      await Promise.all([
        organizationId
          ? this.db.queryOne<{
              total: string;
              new_in_range: string;
              banned_count: string;
              email_verified_count: string;
            }>(
              `SELECT
                 COUNT(DISTINCT m."userId")::text AS total,
                 COUNT(DISTINCT m."userId") FILTER (WHERE m."createdAt" >= NOW() - INTERVAL '${interval}')::text AS new_in_range,
                 COUNT(DISTINCT CASE WHEN u.banned = true THEN m."userId" END)::text AS banned_count,
                 COUNT(DISTINCT CASE WHEN u."emailVerified" IS NOT NULL THEN m."userId" END)::text AS email_verified_count
               FROM member m
               JOIN "user" u ON u.id = m."userId"
               WHERE m."organizationId" = $1`,
              [organizationId],
            )
          : this.db.queryOne<{
              total: string;
              new_in_range: string;
              banned_count: string;
              email_verified_count: string;
            }>(
          `SELECT
             COUNT(*)::text AS total,
             COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '${interval}')::text AS new_in_range,
             COUNT(*) FILTER (WHERE banned = true)::text AS banned_count,
             COUNT(*) FILTER (WHERE "emailVerified" IS NOT NULL)::text AS email_verified_count
           FROM "user"`,
        ),
        organizationId
          ? this.db.query<{ date: string; count: string }>(
              `SELECT DATE(m."createdAt")::text AS date, COUNT(DISTINCT m."userId")::text AS count
               FROM member m
               WHERE m."createdAt" >= NOW() - INTERVAL '${interval}'
                 AND m."organizationId" = $1
               GROUP BY DATE(m."createdAt")
               ORDER BY date`,
              [organizationId],
            )
          : this.db.query<{ date: string; count: string }>(
              `SELECT DATE("createdAt")::text AS date, COUNT(*)::text AS count
               FROM "user"
               WHERE "createdAt" >= NOW() - INTERVAL '${interval}'
               GROUP BY DATE("createdAt")
               ORDER BY date`,
            ),
        organizationId
          ? this.db.query<{
              user_id: string;
              name: string;
              email: string;
              role: string;
              conversation_count: number;
              message_count: number;
              organization_count: number;
              last_active_at: string | null;
            }>(
              `SELECT
                 u.id as user_id,
                 u.name,
                 u.email,
                 u.role,
                 COUNT(DISTINCT c.id)::int as conversation_count,
                 COUNT(DISTINCT CASE WHEN msg.role = 'user' THEN msg.id END)::int as message_count,
                 COUNT(DISTINCT m."organizationId")::int as organization_count,
                 MAX(c.updated_at) as last_active_at
               FROM "user" u
               LEFT JOIN conversation c ON c.user_id = u.id
               LEFT JOIN message msg ON msg.conversation_id = c.id
               LEFT JOIN member m ON m."userId" = u.id
               WHERE m."organizationId" = $1
               GROUP BY u.id, u.name, u.email, u.role
               ORDER BY conversation_count DESC, message_count DESC
               LIMIT 10`,
              [organizationId],
            )
          : this.db.query<{
              user_id: string;
              name: string;
              email: string;
              role: string;
              conversation_count: number;
              message_count: number;
              organization_count: number;
              last_active_at: string | null;
            }>(
              `SELECT
                 u.id as user_id,
                 u.name,
                 u.email,
                 u.role,
                 COUNT(DISTINCT c.id)::int as conversation_count,
                 COUNT(DISTINCT CASE WHEN msg.role = 'user' THEN msg.id END)::int as message_count,
                 COUNT(DISTINCT m."organizationId")::int as organization_count,
                 MAX(c.updated_at) as last_active_at
               FROM "user" u
               LEFT JOIN conversation c ON c.user_id = u.id
               LEFT JOIN message msg ON msg.conversation_id = c.id
               LEFT JOIN member m ON m."userId" = u.id
               GROUP BY u.id, u.name, u.email, u.role
               ORDER BY conversation_count DESC, message_count DESC
               LIMIT 10`,
            ),
        this.db.queryOne<{ active: string; expired: string; impersonated: string }>(
          `SELECT
             COUNT(*) FILTER (WHERE "expiresAt" > NOW())::text AS active,
             COUNT(*) FILTER (WHERE "expiresAt" <= NOW())::text AS expired,
             COUNT(*) FILTER (WHERE "impersonatedBy" IS NOT NULL)::text AS impersonated
           FROM session`,
        ),
        this.db.query<{ browser: string; count: string }>(
          `SELECT
             COALESCE(SPLIT_PART("userAgent", '/', 1), 'Unknown') as browser,
             COUNT(*)::int::text as count
           FROM session
           GROUP BY browser
           ORDER BY count DESC
           LIMIT 5`,
        ),
      ]);

    return {
      total: parseInt(totals?.total ?? '0', 10),
      newInRange: parseInt(totals?.new_in_range ?? '0', 10),
      bannedCount: parseInt(totals?.banned_count ?? '0', 10),
      emailVerifiedCount: parseInt(totals?.email_verified_count ?? '0', 10),
      timeSeriesNewUsers: timeSeries.map((r) => ({ date: r.date, count: parseInt(r.count, 10) })),
      topUsers: topUsers.map((r) => ({
        userId: r.user_id,
        name: r.name,
        email: r.email,
        role: r.role,
        conversationCount: r.conversation_count,
        messageCount: r.message_count,
        organizationCount: r.organization_count,
        lastActiveAt: r.last_active_at ? new Date(r.last_active_at).toISOString() : null,
      })),
      activeSessions: parseInt(sessionTotals?.active ?? '0', 10),
      expiredSessions: parseInt(sessionTotals?.expired ?? '0', 10),
      impersonatedSessions: parseInt(sessionTotals?.impersonated ?? '0', 10),
      sessionsByBrowser: sessionsByBrowser.map((r) => ({ browser: r.browser, count: parseInt(r.count, 10) })),
    };
  }

  async getChatStats(range: Range, organizationId?: string | null): Promise<ChatStatsDto> {
    const interval = RANGE_INTERVAL[range];
    const orgParams = organizationId ? [organizationId] : undefined;

    const [
      totals,
      roleCounts,
      timeSeriesConversations,
      timeSeriesMessages,
      generatorDist,
      sourceUsage,
      entityBreakdown,
      agentPerf,
      tokenStats,
    ] = await Promise.all([
      organizationId
        ? this.db.queryOne<{
            total_conversations: string;
            total_messages: string;
            avg_messages: string;
            active_in_range: string;
          }>(
            `SELECT
               COUNT(DISTINCT c.id)::text AS total_conversations,
               COUNT(m.id)::text AS total_messages,
               COALESCE(AVG(msg_counts.cnt), 0)::text AS avg_messages,
               COUNT(DISTINCT c.id) FILTER (
                 WHERE c.id IN (
                   SELECT DISTINCT msg2.conversation_id FROM message msg2
                   JOIN conversation c2 ON c2.id = msg2.conversation_id
                   WHERE msg2.created_at > NOW() - INTERVAL '${interval}'
                     AND c2.organization_id = $1
                 )
               )::text AS active_in_range
             FROM conversation c
             LEFT JOIN message m ON m.conversation_id = c.id
             LEFT JOIN (
               SELECT conversation_id, COUNT(*) AS cnt FROM message GROUP BY conversation_id
             ) msg_counts ON msg_counts.conversation_id = c.id
             WHERE c.organization_id = $1`,
            orgParams,
          )
        : this.db.queryOne<{
            total_conversations: string;
            total_messages: string;
            avg_messages: string;
            active_in_range: string;
          }>(
            `SELECT
               COUNT(DISTINCT c.id)::text AS total_conversations,
               COUNT(m.id)::text AS total_messages,
               COALESCE(AVG(msg_counts.cnt), 0)::text AS avg_messages,
               COUNT(DISTINCT c.id) FILTER (
                 WHERE c.id IN (
                   SELECT DISTINCT conversation_id FROM message
                   WHERE created_at > NOW() - INTERVAL '${interval}'
                 )
               )::text AS active_in_range
             FROM conversation c
             LEFT JOIN message m ON m.conversation_id = c.id
             LEFT JOIN (
               SELECT conversation_id, COUNT(*) AS cnt FROM message GROUP BY conversation_id
             ) msg_counts ON msg_counts.conversation_id = c.id`,
          ),
      organizationId
        ? this.db.query<{ role: string; count: string }>(
            `SELECT msg.role, COUNT(*)::text AS count
             FROM message msg
             JOIN conversation c ON c.id = msg.conversation_id
             WHERE c.organization_id = $1
             GROUP BY msg.role ORDER BY count DESC`,
            orgParams,
          )
        : this.db.query<{ role: string; count: string }>(
            `SELECT role, COUNT(*)::text AS count FROM message GROUP BY role ORDER BY count DESC`,
          ),
      organizationId
        ? this.db.query<{ date: string; count: string }>(
            `SELECT DATE(created_at)::text AS date, COUNT(*)::text AS count
             FROM conversation
             WHERE created_at > NOW() - INTERVAL '${interval}' AND organization_id = $1
             GROUP BY DATE(created_at)
             ORDER BY date ASC`,
            orgParams,
          )
        : this.db.query<{ date: string; count: string }>(
            `SELECT DATE(created_at)::text AS date, COUNT(*)::text AS count
             FROM conversation
             WHERE created_at > NOW() - INTERVAL '${interval}'
             GROUP BY DATE(created_at)
             ORDER BY date ASC`,
          ),
      organizationId
        ? this.db.query<{ date: string; user_count: string; assistant_count: string }>(
            `SELECT
               DATE(msg.created_at)::text AS date,
               COUNT(CASE WHEN msg.role = 'user' THEN 1 END)::text AS user_count,
               COUNT(CASE WHEN msg.role = 'assistant' THEN 1 END)::text AS assistant_count
             FROM message msg
             JOIN conversation c ON c.id = msg.conversation_id
             WHERE msg.created_at > NOW() - INTERVAL '${interval}' AND c.organization_id = $1
             GROUP BY DATE(msg.created_at)
             ORDER BY date ASC`,
            orgParams,
          )
        : this.db.query<{ date: string; user_count: string; assistant_count: string }>(
            `SELECT
               DATE(created_at)::text AS date,
               COUNT(CASE WHEN role = 'user' THEN 1 END)::text AS user_count,
               COUNT(CASE WHEN role = 'assistant' THEN 1 END)::text AS assistant_count
             FROM message
             WHERE created_at > NOW() - INTERVAL '${interval}'
             GROUP BY DATE(created_at)
             ORDER BY date ASC`,
          ),
      organizationId
        ? this.db.query<{ generator: string; count: string }>(
            `SELECT
               COALESCE(msg.metadata->>'generator', 'unknown') as generator,
               COUNT(*)::text as count
             FROM message msg
             JOIN conversation c ON c.id = msg.conversation_id
             WHERE msg.role = 'assistant' AND msg.metadata IS NOT NULL AND c.organization_id = $1
             GROUP BY generator
             ORDER BY count DESC`,
            orgParams,
          )
        : this.db.query<{ generator: string; count: string }>(
            `SELECT
               COALESCE(metadata->>'generator', 'unknown') as generator,
               COUNT(*)::text as count
             FROM message
             WHERE role = 'assistant' AND metadata IS NOT NULL
             GROUP BY generator
             ORDER BY count DESC`,
          ),
      organizationId
        ? this.db.query<{ source_name: string; count: string }>(
            `SELECT
               s->>'sourceName' as source_name,
               COUNT(*)::text as count
             FROM message msg
             JOIN conversation c ON c.id = msg.conversation_id,
               jsonb_array_elements(msg.metadata->'sources') as s
             WHERE msg.metadata IS NOT NULL AND msg.metadata->'sources' IS NOT NULL
               AND jsonb_typeof(msg.metadata->'sources') = 'array'
               AND c.organization_id = $1
             GROUP BY source_name
             ORDER BY count DESC`,
            orgParams,
          )
        : this.db.query<{ source_name: string; count: string }>(
            `SELECT
               s->>'sourceName' as source_name,
               COUNT(*)::text as count
             FROM message,
               jsonb_array_elements(metadata->'sources') as s
             WHERE metadata IS NOT NULL AND metadata->'sources' IS NOT NULL
               AND jsonb_typeof(metadata->'sources') = 'array'
             GROUP BY source_name
             ORDER BY count DESC`,
          ),
      organizationId
        ? this.db.query<{ entity_type: string; count: string }>(
            `SELECT
               s->>'entityType' as entity_type,
               COUNT(*)::text as count
             FROM message msg
             JOIN conversation c ON c.id = msg.conversation_id,
               jsonb_array_elements(msg.metadata->'sources') as s
             WHERE msg.metadata IS NOT NULL AND msg.metadata->'sources' IS NOT NULL
               AND jsonb_typeof(msg.metadata->'sources') = 'array'
               AND c.organization_id = $1
             GROUP BY entity_type
             ORDER BY count DESC`,
            orgParams,
          )
        : this.db.query<{ entity_type: string; count: string }>(
            `SELECT
               s->>'entityType' as entity_type,
               COUNT(*)::text as count
             FROM message,
               jsonb_array_elements(metadata->'sources') as s
             WHERE metadata IS NOT NULL AND metadata->'sources' IS NOT NULL
               AND jsonb_typeof(metadata->'sources') = 'array'
             GROUP BY entity_type
             ORDER BY count DESC`,
          ),
      organizationId
        ? this.db.queryOne<{ avg_tool_calls: string | null; avg_results: string | null }>(
            `SELECT
               AVG((msg.metadata->>'toolCallCount')::numeric)::text AS avg_tool_calls,
               AVG((msg.metadata->>'resultCount')::numeric)::text AS avg_results
             FROM message msg
             JOIN conversation c ON c.id = msg.conversation_id
             WHERE msg.role = 'assistant' AND msg.metadata IS NOT NULL AND c.organization_id = $1`,
            orgParams,
          )
        : this.db.queryOne<{ avg_tool_calls: string | null; avg_results: string | null }>(
            `SELECT
               AVG((metadata->>'toolCallCount')::numeric)::text AS avg_tool_calls,
               AVG((metadata->>'resultCount')::numeric)::text AS avg_results
             FROM message
             WHERE role = 'assistant' AND metadata IS NOT NULL`,
          ),
      organizationId
        ? this.db.queryOne<{
            total_tokens: string | null;
            total_prompt_tokens: string | null;
            total_completion_tokens: string | null;
            avg_tokens: string | null;
            messages_with_token_data: string;
          }>(
            `SELECT
               SUM((msg.metadata->>'totalTokens')::int)::text AS total_tokens,
               SUM((msg.metadata->>'promptTokens')::int)::text AS total_prompt_tokens,
               SUM((msg.metadata->>'completionTokens')::int)::text AS total_completion_tokens,
               AVG((msg.metadata->>'totalTokens')::int)::text AS avg_tokens,
               COUNT(CASE WHEN msg.metadata->>'totalTokens' IS NOT NULL THEN 1 END)::text AS messages_with_token_data
             FROM message msg
             JOIN conversation c ON c.id = msg.conversation_id
             WHERE msg.role = 'assistant' AND msg.metadata IS NOT NULL AND c.organization_id = $1`,
            orgParams,
          )
        : this.db.queryOne<{
            total_tokens: string | null;
            total_prompt_tokens: string | null;
            total_completion_tokens: string | null;
            avg_tokens: string | null;
            messages_with_token_data: string;
          }>(
            `SELECT
               SUM((metadata->>'totalTokens')::int)::text AS total_tokens,
               SUM((metadata->>'promptTokens')::int)::text AS total_prompt_tokens,
               SUM((metadata->>'completionTokens')::int)::text AS total_completion_tokens,
               AVG((metadata->>'totalTokens')::int)::text AS avg_tokens,
               COUNT(CASE WHEN metadata->>'totalTokens' IS NOT NULL THEN 1 END)::text AS messages_with_token_data
             FROM message
             WHERE role = 'assistant' AND metadata IS NOT NULL`,
          ),
    ]);

    const assistantCount = parseInt(roleCounts.find((r) => r.role === 'assistant')?.count ?? '0', 10);
    const userCount = parseInt(roleCounts.find((r) => r.role === 'user')?.count ?? '0', 10);
    const totalGeneratorCount = generatorDist.reduce((sum, r) => sum + parseInt(r.count, 10), 0);

    return {
      totalConversations: parseInt(totals?.total_conversations ?? '0', 10),
      totalMessages: parseInt(totals?.total_messages ?? '0', 10),
      assistantMessages: assistantCount,
      userMessages: userCount,
      avgMessagesPerConversation: parseFloat(totals?.avg_messages ?? '0'),
      activeConversationsInRange: parseInt(totals?.active_in_range ?? '0', 10),
      timeSeriesConversations: timeSeriesConversations.map((r) => ({ date: r.date, count: parseInt(r.count, 10) })),
      timeSeriesMessages: timeSeriesMessages.map((r) => ({
        date: r.date,
        userCount: parseInt(r.user_count, 10),
        assistantCount: parseInt(r.assistant_count, 10),
      })),
      generatorDistribution: generatorDist.map((r) => {
        const count = parseInt(r.count, 10);
        return {
          generator: r.generator,
          count,
          percentage: totalGeneratorCount > 0 ? Math.round((count / totalGeneratorCount) * 10000) / 100 : 0,
        };
      }),
      sourceIntegrationUsage: sourceUsage.map((r) => ({ sourceName: r.source_name, count: parseInt(r.count, 10) })),
      entityTypeBreakdown: entityBreakdown.map((r) => ({ entityType: r.entity_type, count: parseInt(r.count, 10) })),
      avgToolCallsPerResponse: agentPerf?.avg_tool_calls != null ? parseFloat(agentPerf.avg_tool_calls) : null,
      avgResultsPerResponse: agentPerf?.avg_results != null ? parseFloat(agentPerf.avg_results) : null,
      totalTokens: tokenStats?.total_tokens != null ? parseInt(tokenStats.total_tokens, 10) : null,
      totalPromptTokens: tokenStats?.total_prompt_tokens != null ? parseInt(tokenStats.total_prompt_tokens, 10) : null,
      totalCompletionTokens: tokenStats?.total_completion_tokens != null ? parseInt(tokenStats.total_completion_tokens, 10) : null,
      avgTokensPerResponse: tokenStats?.avg_tokens != null ? parseFloat(tokenStats.avg_tokens) : null,
      messagesWithTokenData: parseInt(tokenStats?.messages_with_token_data ?? '0', 10),
    };
  }

  async getOrgStats(organizationId?: string | null): Promise<OrgStatsDto> {
    const orgParams = organizationId ? [organizationId] : undefined;

    const [totalOrgs, pendingInvitations, conversationsPerOrg, membersPerOrg, memberRoleDistribution, mostActiveOrgs] =
      await Promise.all([
        organizationId
          ? Promise.resolve({ total: '1' } as { total: string })
          : this.db.queryOne<{ total: string }>(
              `SELECT COUNT(*)::text AS total FROM organization`,
            ),
        organizationId
          ? this.db.queryOne<{ count: string }>(
              `SELECT COUNT(*)::text AS count FROM invitation WHERE "organizationId" = $1 AND status = 'pending'`,
              orgParams,
            )
          : this.db.queryOne<{ count: string }>(
              `SELECT COUNT(*)::text AS count FROM invitation WHERE status = 'pending'`,
            ),
        organizationId
          ? this.db.query<{
              org_id: string;
              org_name: string;
              conversation_count: string;
              message_count: string;
            }>(
              `SELECT
                 o.id AS org_id,
                 o.name AS org_name,
                 COUNT(DISTINCT c.id)::text AS conversation_count,
                 COUNT(DISTINCT msg.id)::text AS message_count
               FROM organization o
               LEFT JOIN conversation c ON c.organization_id = o.id
               LEFT JOIN message msg ON msg.conversation_id = c.id
               WHERE o.id = $1
               GROUP BY o.id, o.name
               ORDER BY conversation_count DESC`,
              orgParams,
            )
          : this.db.query<{
              org_id: string;
              org_name: string;
              conversation_count: string;
              message_count: string;
            }>(
              `SELECT
                 o.id AS org_id,
                 o.name AS org_name,
                 COUNT(DISTINCT c.id)::text AS conversation_count,
                 COUNT(DISTINCT msg.id)::text AS message_count
               FROM organization o
               LEFT JOIN conversation c ON c.organization_id = o.id
               LEFT JOIN message msg ON msg.conversation_id = c.id
               GROUP BY o.id, o.name
               ORDER BY conversation_count DESC`,
            ),
        organizationId
          ? this.db.query<{ org_id: string; org_name: string; member_count: string }>(
              `SELECT
                 o.id AS org_id,
                 o.name AS org_name,
                 COUNT(m.id)::text AS member_count
               FROM organization o
               LEFT JOIN member m ON m."organizationId" = o.id
               WHERE o.id = $1
               GROUP BY o.id, o.name
               ORDER BY member_count DESC`,
              orgParams,
            )
          : this.db.query<{ org_id: string; org_name: string; member_count: string }>(
              `SELECT
                 o.id AS org_id,
                 o.name AS org_name,
                 COUNT(m.id)::text AS member_count
               FROM organization o
               LEFT JOIN member m ON m."organizationId" = o.id
               GROUP BY o.id, o.name
               ORDER BY member_count DESC`,
            ),
        organizationId
          ? this.db.query<{ role: string; count: string }>(
              `SELECT role, COUNT(*)::text AS count FROM member WHERE "organizationId" = $1 GROUP BY role ORDER BY count DESC`,
              orgParams,
            )
          : this.db.query<{ role: string; count: string }>(
              `SELECT role, COUNT(*)::text AS count FROM member GROUP BY role ORDER BY count DESC`,
            ),
        organizationId
          ? this.db.query<{ org_id: string; org_name: string; recent_message_count: string }>(
              `SELECT
                 o.id AS org_id,
                 o.name AS org_name,
                 COUNT(msg.id)::text AS recent_message_count
               FROM organization o
               LEFT JOIN conversation c ON c.organization_id = o.id
               LEFT JOIN message msg ON msg.conversation_id = c.id
                 AND msg.created_at > NOW() - INTERVAL '30 days'
               WHERE o.id = $1
               GROUP BY o.id, o.name
               ORDER BY recent_message_count DESC
               LIMIT 10`,
              orgParams,
            )
          : this.db.query<{ org_id: string; org_name: string; recent_message_count: string }>(
              `SELECT
                 o.id AS org_id,
                 o.name AS org_name,
                 COUNT(msg.id)::text AS recent_message_count
               FROM organization o
               LEFT JOIN conversation c ON c.organization_id = o.id
               LEFT JOIN message msg ON msg.conversation_id = c.id
                 AND msg.created_at > NOW() - INTERVAL '30 days'
               GROUP BY o.id, o.name
               ORDER BY recent_message_count DESC
               LIMIT 10`,
            ),
      ]);

    return {
      totalOrganizations: parseInt(totalOrgs?.total ?? '0', 10),
      pendingInvitations: parseInt(pendingInvitations?.count ?? '0', 10),
      conversationsPerOrg: conversationsPerOrg.map((r) => ({
        orgId: r.org_id,
        orgName: r.org_name,
        conversationCount: parseInt(r.conversation_count, 10),
        messageCount: parseInt(r.message_count, 10),
      })),
      membersPerOrg: membersPerOrg.map((r) => ({
        orgId: r.org_id,
        orgName: r.org_name,
        memberCount: parseInt(r.member_count, 10),
      })),
      memberRoleDistribution: memberRoleDistribution.map((r) => ({
        role: r.role,
        count: parseInt(r.count, 10),
      })),
      mostActiveOrgs: mostActiveOrgs.map((r) => ({
        orgId: r.org_id,
        orgName: r.org_name,
        recentMessageCount: parseInt(r.recent_message_count, 10),
      })),
    };
  }
}
