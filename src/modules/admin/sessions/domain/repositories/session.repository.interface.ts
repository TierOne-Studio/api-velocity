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

export const SESSION_REPOSITORY = 'SESSION_REPOSITORY';

export interface ISessionRepository {
  findSessionByToken(token: string): Promise<{ userId: string } | null>;
  revokeSession(token: string): Promise<void>;
  revokeAllSessions(userId: string): Promise<void>;
  listUserSessions(userId: string): Promise<SessionRow[]>;
  findMemberInOrg(
    userId: string,
    organizationId: string,
  ): Promise<{ id: string } | null>;
}
