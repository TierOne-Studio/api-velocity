export interface OrgConversationStats {
  orgId: string;
  orgName: string;
  conversationCount: number;
  messageCount: number;
}

export interface OrgMemberStats {
  orgId: string;
  orgName: string;
  memberCount: number;
}

export interface RoleCount {
  role: string;
  count: number;
}

export interface OrgActivityStats {
  orgId: string;
  orgName: string;
  recentMessageCount: number;
}

export interface OrgStatsDto {
  totalOrganizations: number;
  pendingInvitations: number;
  conversationsPerOrg: OrgConversationStats[];
  membersPerOrg: OrgMemberStats[];
  memberRoleDistribution: RoleCount[];
  mostActiveOrgs: OrgActivityStats[];
}
