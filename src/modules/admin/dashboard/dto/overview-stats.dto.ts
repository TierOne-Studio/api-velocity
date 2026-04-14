export interface OverviewStatsDto {
  totalUsers: number;
  bannedUsers: number;
  activeSessions: number;
  totalOrganizations: number;
  totalConversations: number;
  totalMessages: number;
  assistantMessages: number;
  totalTokensAllTime: number | null;
}
