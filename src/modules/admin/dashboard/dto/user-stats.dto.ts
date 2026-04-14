export interface DateCount {
  date: string;
  count: number;
}

export interface TopUser {
  userId: string;
  name: string;
  email: string;
  role: string;
  conversationCount: number;
  messageCount: number;
  organizationCount: number;
  lastActiveAt: string | null;
}

export interface BrowserCount {
  browser: string;
  count: number;
}

export interface UserStatsDto {
  total: number;
  newInRange: number;
  bannedCount: number;
  emailVerifiedCount: number;
  timeSeriesNewUsers: DateCount[];
  topUsers: TopUser[];
  activeSessions: number;
  expiredSessions: number;
  impersonatedSessions: number;
  sessionsByBrowser: BrowserCount[];
}
