export interface DateCount {
  date: string;
  count: number;
}

export interface UserAgentCount {
  userAgent: string;
  count: number;
}

export interface SessionStatsDto {
  total: number;
  activeSessions: number;
  impersonatedCount: number;
  timeSeriesCreated: DateCount[];
  byUserAgent: UserAgentCount[];
}
