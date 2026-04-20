export interface UserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: string;
  image: string | null;
  banned: boolean | null;
  banReason: string | null;
  banExpires: Date | null;
  approvalStatus: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  memberships?: UserMembershipRow[];
}

export interface UserMembershipRow {
  organizationId: string;
  organizationName: string;
  roleName: string;
  roleDisplayName: string;
}

export interface SessionRow {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface RoleMetaRow {
  name: string;
  display_name: string;
  description: string | null;
  color: string | null;
  is_default: boolean;
}

export interface OrgBasicRow {
  id: string;
  name: string;
  slug: string;
}

export interface CreateUserParams {
  userId: string;
  accountId: string;
  name: string;
  email: string;
  hashedPassword: string;
  role: string;
  organizationId?: string;
}

export interface SetUserRoleParams {
  userId: string;
  role: string;
  organizationId?: string;
  newMemberId: string;
}

export interface ListUsersParams {
  limit: number;
  offset: number;
  searchValue?: string;
  organizationId?: string | null;
  activeOrganizationId: string | null;
  platformRole: 'superadmin' | 'admin' | 'manager' | 'member';
}

export const ADMIN_USER_REPOSITORY = 'ADMIN_USER_REPOSITORY';

export interface IAdminUserRepository {
  findUserRole(userId: string): Promise<string | null>;
  findUserById(userId: string): Promise<UserRow | null>;
  findMemberInOrg(
    userId: string,
    organizationId: string,
  ): Promise<{ id: string } | null>;
  findUserOrganization(
    userId: string,
  ): Promise<{ organizationId: string } | null>;
  updateUser(
    userId: string,
    fields: { name?: string },
  ): Promise<UserRow | null>;
  setUserRole(params: SetUserRoleParams): Promise<UserRow | null>;
  banUser(userId: string, banReason?: string): Promise<void>;
  unbanUser(userId: string): Promise<void>;
  approveUser(userId: string): Promise<void>;
  rejectUser(userId: string, rejectionReason?: string): Promise<void>;
  listPendingUsers(
    params: ListUsersParams,
  ): Promise<{ data: UserRow[]; total: number }>;
  findAcceptedInvitationByEmail(email: string): Promise<{ id: string } | null>;
  setUserPassword(userId: string, hashedPassword: string): Promise<void>;
  removeUser(userId: string): Promise<void>;
  removeUsers(userIds: string[]): Promise<number>;
  listUsers(
    params: ListUsersParams,
  ): Promise<{ data: UserRow[]; total: number }>;
  createUser(params: CreateUserParams): Promise<UserRow>;

  findSessionByToken(token: string): Promise<{ userId: string } | null>;
  revokeSession(token: string): Promise<void>;
  revokeAllSessions(userId: string): Promise<void>;
  listUserSessions(userId: string): Promise<SessionRow[]>;

  listRoles(): Promise<RoleMetaRow[]>;
  listOrganizations(): Promise<OrgBasicRow[]>;
  findOrganizationById(id: string): Promise<OrgBasicRow | null>;
}
