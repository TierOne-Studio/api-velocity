import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../../../shared/infrastructure/database/database.module';
import type {
  ISessionRepository,
  SessionRow,
} from '../../../domain/repositories/session.repository.interface';

@Injectable()
export class SessionDatabaseRepository implements ISessionRepository {
  constructor(private readonly db: DatabaseService) {}

  async findSessionByToken(token: string): Promise<{ userId: string } | null> {
    return this.db.queryOne<{ userId: string }>(
      'SELECT "userId" as "userId" FROM session WHERE token = $1',
      [token],
    );
  }

  async revokeSession(token: string): Promise<void> {
    await this.db.query('DELETE FROM session WHERE token = $1', [token]);
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.db.query('DELETE FROM session WHERE "userId" = $1', [userId]);
  }

  async listUserSessions(userId: string): Promise<SessionRow[]> {
    return this.db.query<SessionRow>(
      'SELECT id, "userId" as "userId", token, "expiresAt" as "expiresAt", "createdAt" as "createdAt", "updatedAt" as "updatedAt", "ipAddress" as "ipAddress", "userAgent" as "userAgent" FROM session WHERE "userId" = $1 ORDER BY "createdAt" DESC',
      [userId],
    );
  }

  async findMemberInOrg(
    userId: string,
    organizationId: string,
  ): Promise<{ id: string } | null> {
    return this.db.queryOne<{ id: string }>(
      'SELECT id FROM member WHERE "organizationId" = $1 AND "userId" = $2',
      [organizationId, userId],
    );
  }
}
