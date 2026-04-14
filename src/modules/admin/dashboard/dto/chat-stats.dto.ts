export interface DateCount {
  date: string;
  count: number;
}

export interface DateDualCount {
  date: string;
  userCount: number;
  assistantCount: number;
}

export interface GeneratorCount {
  generator: string;
  count: number;
  percentage: number;
}

export interface SourceNameCount {
  sourceName: string;
  count: number;
}

export interface EntityTypeCount {
  entityType: string;
  count: number;
}

export interface ChatStatsDto {
  totalConversations: number;
  totalMessages: number;
  assistantMessages: number;
  userMessages: number;
  avgMessagesPerConversation: number;
  activeConversationsInRange: number;
  timeSeriesConversations: DateCount[];
  timeSeriesMessages: DateDualCount[];
  generatorDistribution: GeneratorCount[];
  sourceIntegrationUsage: SourceNameCount[];
  entityTypeBreakdown: EntityTypeCount[];
  avgToolCallsPerResponse: number | null;
  avgResultsPerResponse: number | null;
  totalTokens: number | null;
  totalPromptTokens: number | null;
  totalCompletionTokens: number | null;
  avgTokensPerResponse: number | null;
  messagesWithTokenData: number;
}
