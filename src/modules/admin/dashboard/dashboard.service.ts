import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../shared/infrastructure/database/database.module';
import { OverviewStatsDto } from './dto/overview-stats.dto';
import { UserStatsDto } from './dto/user-stats.dto';
import { SessionStatsDto } from './dto/session-stats.dto';
import { ChatStatsDto } from './dto/chat-stats.dto';
import { ProjectStatsDto } from './dto/project-stats.dto';

type Range = '7d' | '30d' | '90d';

const RANGE_INTERVAL: Record<Range, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
};

@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService) {}

  async getOverview(): Promise<OverviewStatsDto> {
    const [users, sessions, orgs, conversations, messages, projects] =
      await Promise.all([
        this.db.queryOne<{
          total: string;
          active: string;
          banned: string;
        }>(
          `SELECT
             COUNT(*)::text AS total,
             COUNT(*) FILTER (WHERE "emailVerified" IS NOT NULL)::text AS active,
             COUNT(*) FILTER (WHERE banned = true)::text AS banned
           FROM "user"`,
        ),
        this.db.queryOne<{ active: string }>(
          `SELECT COUNT(*)::text AS active FROM session WHERE "expiresAt" > NOW()`,
        ),
        this.db.queryOne<{ total: string }>(
          `SELECT COUNT(*)::text AS total FROM organization`,
        ),
        this.db.queryOne<{ total: string }>(
          `SELECT COUNT(*)::text AS total FROM conversation`,
        ),
        this.db.queryOne<{ total: string }>(
          `SELECT COUNT(*)::text AS total FROM message`,
        ),
        this.db.queryOne<{ total: string }>(
          `SELECT COUNT(*)::text AS total FROM project`,
        ),
      ]);

    return {
      totalUsers: parseInt(users?.total ?? '0', 10),
      activeUsers: parseInt(users?.active ?? '0', 10),
      bannedUsers: parseInt(users?.banned ?? '0', 10),
      activeSessions: parseInt(sessions?.active ?? '0', 10),
      totalOrganizations: parseInt(orgs?.total ?? '0', 10),
      totalConversations: parseInt(conversations?.total ?? '0', 10),
      totalMessages: parseInt(messages?.total ?? '0', 10),
      totalProjects: parseInt(projects?.total ?? '0', 10),
    };
  }

  async getUserStats(range: Range): Promise<UserStatsDto> {
    const interval = RANGE_INTERVAL[range];

    const [totals, byRole, timeSeries] = await Promise.all([
      this.db.queryOne<{
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
      this.db.query<{ role: string; count: string }>(
        `SELECT role, COUNT(*)::text AS count FROM "user" GROUP BY role ORDER BY count DESC`,
      ),
      this.db.query<{ date: string; count: string }>(
        `SELECT DATE("createdAt")::text AS date, COUNT(*)::text AS count
         FROM "user"
         WHERE "createdAt" >= NOW() - INTERVAL '${interval}'
         GROUP BY DATE("createdAt")
         ORDER BY date`,
      ),
    ]);

    return {
      total: parseInt(totals?.total ?? '0', 10),
      newInRange: parseInt(totals?.new_in_range ?? '0', 10),
      bannedCount: parseInt(totals?.banned_count ?? '0', 10),
      emailVerifiedCount: parseInt(totals?.email_verified_count ?? '0', 10),
      byRole: byRole.map((r) => ({ role: r.role, count: parseInt(r.count, 10) })),
      timeSeriesNewUsers: timeSeries.map((r) => ({ date: r.date, count: parseInt(r.count, 10) })),
    };
  }

  async getSessionStats(range: Range): Promise<SessionStatsDto> {
    const interval = RANGE_INTERVAL[range];

    const [totals, timeSeries, byUserAgent] = await Promise.all([
      this.db.queryOne<{
        total: string;
        active: string;
        impersonated: string;
      }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE "expiresAt" > NOW())::text AS active,
           COUNT(*) FILTER (WHERE "impersonatedBy" IS NOT NULL)::text AS impersonated
         FROM session`,
      ),
      this.db.query<{ date: string; count: string }>(
        `SELECT DATE("createdAt")::text AS date, COUNT(*)::text AS count
         FROM session
         WHERE "createdAt" >= NOW() - INTERVAL '${interval}'
         GROUP BY DATE("createdAt")
         ORDER BY date`,
      ),
      this.db.query<{ user_agent: string; count: string }>(
        `SELECT "userAgent" AS user_agent, COUNT(*)::text AS count
         FROM session
         WHERE "userAgent" IS NOT NULL
         GROUP BY "userAgent"
         ORDER BY count DESC
         LIMIT 5`,
      ),
    ]);

    return {
      total: parseInt(totals?.total ?? '0', 10),
      activeSessions: parseInt(totals?.active ?? '0', 10),
      impersonatedCount: parseInt(totals?.impersonated ?? '0', 10),
      timeSeriesCreated: timeSeries.map((r) => ({ date: r.date, count: parseInt(r.count, 10) })),
      byUserAgent: byUserAgent.map((r) => ({ userAgent: r.user_agent, count: parseInt(r.count, 10) })),
    };
  }

  async getChatStats(range: Range): Promise<ChatStatsDto> {
    const interval = RANGE_INTERVAL[range];

    const [totals, byRole, timeSeries] = await Promise.all([
      this.db.queryOne<{
        total_conversations: string;
        total_messages: string;
        avg_messages: string;
        active_in_range: string;
      }>(
        `SELECT
           COUNT(DISTINCT c.id)::text AS total_conversations,
           COUNT(m.id)::text AS total_messages,
           COALESCE(AVG(msg_counts.cnt), 0)::text AS avg_messages,
           COUNT(DISTINCT c.id) FILTER (WHERE c.created_at >= NOW() - INTERVAL '${interval}')::text AS active_in_range
         FROM conversation c
         LEFT JOIN message m ON m.conversation_id = c.id
         LEFT JOIN (
           SELECT conversation_id, COUNT(*) AS cnt FROM message GROUP BY conversation_id
         ) msg_counts ON msg_counts.conversation_id = c.id`,
      ),
      this.db.query<{ role: string; count: string }>(
        `SELECT role, COUNT(*)::text AS count FROM message GROUP BY role ORDER BY count DESC`,
      ),
      this.db.query<{ date: string; count: string }>(
        `SELECT DATE(created_at)::text AS date, COUNT(*)::text AS count
         FROM conversation
         WHERE created_at >= NOW() - INTERVAL '${interval}'
         GROUP BY DATE(created_at)
         ORDER BY date`,
      ),
    ]);

    return {
      totalConversations: parseInt(totals?.total_conversations ?? '0', 10),
      totalMessages: parseInt(totals?.total_messages ?? '0', 10),
      avgMessagesPerConversation: parseFloat(totals?.avg_messages ?? '0'),
      activeConversationsInRange: parseInt(totals?.active_in_range ?? '0', 10),
      byRole: byRole.map((r) => ({ role: r.role, count: parseInt(r.count, 10) })),
      timeSeriesConversations: timeSeries.map((r) => ({ date: r.date, count: parseInt(r.count, 10) })),
    };
  }

  async getProjectStats(): Promise<ProjectStatsDto> {
    const [totals, byStatus, byPhase, dataSources, dsByType, dsByStatus] =
      await Promise.all([
        this.db.queryOne<{ total: string }>(
          `SELECT COUNT(*)::text AS total FROM project`,
        ),
        this.db.query<{ status: string; count: string }>(
          `SELECT status, COUNT(*)::text AS count FROM project GROUP BY status ORDER BY count DESC`,
        ),
        this.db.query<{ phase: string; count: string }>(
          `SELECT phase, COUNT(*)::text AS count FROM project WHERE phase IS NOT NULL GROUP BY phase ORDER BY count DESC`,
        ),
        this.db.queryOne<{ total: string; entity_count: string }>(
          `SELECT COUNT(*)::text AS total, COALESCE(SUM(entity_count), 0)::text AS entity_count FROM data_source`,
        ),
        this.db.query<{ type: string; count: string }>(
          `SELECT type, COUNT(*)::text AS count FROM data_source GROUP BY type ORDER BY count DESC`,
        ),
        this.db.query<{ status: string; count: string }>(
          `SELECT status, COUNT(*)::text AS count FROM data_source GROUP BY status ORDER BY count DESC`,
        ),
      ]);

    return {
      totalProjects: parseInt(totals?.total ?? '0', 10),
      byStatus: byStatus.map((r) => ({ status: r.status, count: parseInt(r.count, 10) })),
      byPhase: byPhase.map((r) => ({ phase: r.phase, count: parseInt(r.count, 10) })),
      totalDataSources: parseInt(dataSources?.total ?? '0', 10),
      dataSourcesByType: dsByType.map((r) => ({ type: r.type, count: parseInt(r.count, 10) })),
      dataSourcesByStatus: dsByStatus.map((r) => ({ status: r.status, count: parseInt(r.count, 10) })),
      totalEntityCount: parseInt(dataSources?.entity_count ?? '0', 10),
    };
  }
}
