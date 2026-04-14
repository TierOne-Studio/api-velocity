export interface RoleCount {
  role: string;
  count: number;
}

export interface DateCount {
  date: string;
  count: number;
}

export interface ChatStatsDto {
  totalConversations: number;
  totalMessages: number;
  avgMessagesPerConversation: number;
  activeConversationsInRange: number;
  byRole: RoleCount[];
  timeSeriesConversations: DateCount[];
}
