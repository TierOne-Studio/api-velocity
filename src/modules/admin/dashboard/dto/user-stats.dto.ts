export interface RoleCount {
  role: string;
  count: number;
}

export interface DateCount {
  date: string;
  count: number;
}

export interface UserStatsDto {
  total: number;
  newInRange: number;
  bannedCount: number;
  emailVerifiedCount: number;
  byRole: RoleCount[];
  timeSeriesNewUsers: DateCount[];
}
