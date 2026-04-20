import { ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../../../../../shared/infrastructure/database/database.module';
import type {
  IAdminUserRepository,
  UserRow,
  SessionRow,
  RoleMetaRow,
  OrgBasicRow,
  CreateUserParams,
  SetUserRoleParams,
  ListUsersParams,
} from '../../../domain/repositories/admin-user.repository.interface';

const USER_COLUMNS = `id, name, email, "emailVerified" as "emailVerified", role, image, banned, "banReason" as "banReason", "banExpires" as "banExpires", "approvalStatus" as "approvalStatus", "rejectionReason" as "rejectionReason", "createdAt" as "createdAt", "updatedAt" as "updatedAt"`;
const USER_LIST_COLUMNS = `u.id, u.name, u.email, u."emailVerified" as "emailVerified", u.role, u.image, u.banned, u."banReason" as "banReason", u."banExpires" as "banExpires", u."approvalStatus" as "approvalStatus", u."rejectionReason" as "rejectionReason", u."createdAt" as "createdAt", u."updatedAt" as "updatedAt",
       COALESCE((
         SELECT json_agg(
           json_build_object(
             'organizationId', m."organizationId",
             'organizationName', o.name,
             'roleName', m.role,
             'roleDisplayName', COALESCE(r.display_name, m.role)
           )
           ORDER BY o.name ASC, COALESCE(r.display_name, m.role) ASC
         )
         FROM member m
         JOIN organization o ON o.id = m."organizationId"
         LEFT JOIN roles r ON r.organization_id = m."organizationId" AND r.name = m.role
         WHERE m."userId" = u.id
       ), '[]'::json) as memberships`;

@Injectable()
export class AdminUserDatabaseRepository implements IAdminUserRepository {
  constructor(private readonly db: DatabaseService) {}

  async findUserRole(userId: string): Promise<string | null> {
    const row = await this.db.queryOne<{ role: string | null }>(
      'SELECT role FROM "user" WHERE id = $1',
      [userId],
    );
    if (!row) return null; // user not found
    return row.role ?? 'member'; // null platform role → treat as member-level
  }

  async findUserById(userId: string): Promise<UserRow | null> {
    return this.db.queryOne<UserRow>(
      `SELECT ${USER_COLUMNS} FROM "user" WHERE id = $1`,
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

  async findUserOrganization(
    userId: string,
  ): Promise<{ organizationId: string } | null> {
    return this.db.queryOne<{ organizationId: string }>(
      'SELECT "organizationId" as "organizationId" FROM member WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 1',
      [userId],
    );
  }

  async updateUser(
    userId: string,
    fields: { name?: string },
  ): Promise<UserRow | null> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (fields.name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(fields.name);
    }
    if (updates.length === 0) return this.findUserById(userId);

    updates.push(`"updatedAt" = NOW()`);
    values.push(userId);

    return this.db.queryOne<UserRow>(
      `UPDATE "user" SET ${updates.join(', ')} WHERE id = $${idx} RETURNING ${USER_COLUMNS}`,
      values,
    );
  }

  async setUserRole(params: SetUserRoleParams): Promise<UserRow | null> {
    const { userId, role, organizationId, newMemberId } = params;

    await this.db.transaction(async (query) => {
      await query(
        'UPDATE "user" SET role = $1, "updatedAt" = NOW() WHERE id = $2',
        [role, userId],
      );

      if (role === 'admin') {
        await query('DELETE FROM member WHERE "userId" = $1', [userId]);
      } else {
        const orgId = organizationId;
        if (!orgId)
          throw new ForbiddenException('Active organization required');

        const existing = await query(
          'SELECT id FROM member WHERE "organizationId" = $1 AND "userId" = $2',
          [orgId, userId],
        );

        if (existing.length > 0) {
          await query(
            'UPDATE member SET role = $1 WHERE "organizationId" = $2 AND "userId" = $3',
            [role, orgId, userId],
          );
        } else {
          await query(
            'INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, NOW())',
            [newMemberId, orgId, userId, role],
          );
        }
      }
    });

    return this.findUserById(userId);
  }

  async banUser(userId: string, banReason?: string): Promise<void> {
    await this.db.query(
      'UPDATE "user" SET banned = true, "banReason" = $1, "updatedAt" = NOW() WHERE id = $2',
      [banReason ?? null, userId],
    );
  }

  async unbanUser(userId: string): Promise<void> {
    await this.db.query(
      'UPDATE "user" SET banned = false, "banReason" = NULL, "banExpires" = NULL, "updatedAt" = NOW() WHERE id = $1',
      [userId],
    );
  }

  async setUserPassword(userId: string, hashedPassword: string): Promise<void> {
    await this.db.query(
      'UPDATE account SET password = $1, "updatedAt" = NOW() WHERE "userId" = $2 AND "providerId" = $3',
      [hashedPassword, userId, 'credential'],
    );
  }

  async removeUser(userId: string): Promise<void> {
    await this.db.query('DELETE FROM "user" WHERE id = $1', [userId]);
  }

  async removeUsers(userIds: string[]): Promise<number> {
    if (userIds.length === 0) return 0;
    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(', ');
    const deleted = await this.db.query<{ id: string }>(
      `DELETE FROM "user" WHERE id IN (${placeholders}) RETURNING id`,
      userIds,
    );
    return deleted.length;
  }

  async listUsers(
    params: ListUsersParams,
  ): Promise<{ data: UserRow[]; total: number }> {
    const {
      limit,
      offset,
      searchValue,
      organizationId,
      platformRole,
      activeOrganizationId,
    } = params;
    const where: string[] = [];
    const values: unknown[] = [];

    if (searchValue) {
      values.push(`%${searchValue}%`);
      where.push(
        `(u.name ILIKE $${values.length} OR u.email ILIKE $${values.length})`,
      );
    }

    if (platformRole === 'superadmin' && organizationId) {
      values.push(organizationId);
      where.push(
        `EXISTS (SELECT 1 FROM member m WHERE m."userId" = u.id AND m."organizationId" = $${values.length})`,
      );
    } else if (platformRole !== 'superadmin') {
      values.push(activeOrganizationId);
      where.push(
        `EXISTS (SELECT 1 FROM member m WHERE m."userId" = u.id AND m."organizationId" = $${values.length})`,
      );
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countValues = [...values];

    values.push(Math.max(0, Math.trunc(limit)));
    const limitParam = `$${values.length}`;
    values.push(Math.max(0, Math.trunc(offset)));
    const offsetParam = `$${values.length}`;

    const data = await this.db.query<UserRow>(
      `SELECT ${USER_LIST_COLUMNS}
       FROM "user" u ${whereSql}
       ORDER BY u."createdAt" DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      values,
    );

    const totalRow = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM "user" u ${whereSql}`,
      countValues,
    );

    return { data, total: totalRow ? parseInt(totalRow.count, 10) : 0 };
  }

  async createUser(params: CreateUserParams): Promise<UserRow> {
    const {
      userId,
      accountId,
      name,
      email,
      hashedPassword,
      role,
      organizationId,
    } = params;

    await this.db.transaction(async (query) => {
      const existing = await query('SELECT id FROM "user" WHERE email = $1', [
        email.toLowerCase(),
      ]);
      if (existing.length > 0)
        throw new ForbiddenException('User already exists');

      await query(
        `INSERT INTO "user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt", role, banned, "approvalStatus")
         VALUES ($1, $2, $3, false, NULL, NOW(), NOW(), $4, false, 'approved')`,
        [userId, name, email.toLowerCase(), role],
      );

      await query(
        `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [accountId, userId, 'credential', userId, hashedPassword],
      );

      if (organizationId) {
        await query(
          `INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, NOW())`,
          [randomUUID(), organizationId, userId, role],
        );
      }
    });

    const created = await this.findUserById(userId);
    if (!created)
      throw new Error(
        'Failed to create user: user not found after transaction',
      );
    return created;
  }

  async approveUser(userId: string): Promise<void> {
    await this.db.query(
      'UPDATE "user" SET "approvalStatus" = \'approved\', "rejectionReason" = NULL, "updatedAt" = NOW() WHERE id = $1',
      [userId],
    );
  }

  async rejectUser(userId: string, rejectionReason?: string): Promise<void> {
    await this.db.query(
      'UPDATE "user" SET "approvalStatus" = \'rejected\', "rejectionReason" = $1, "updatedAt" = NOW() WHERE id = $2',
      [rejectionReason ?? null, userId],
    );
  }

  async listPendingUsers(
    params: ListUsersParams,
  ): Promise<{ data: UserRow[]; total: number }> {
    const { limit, offset, searchValue, platformRole, activeOrganizationId } =
      params;
    const where: string[] = [`u."approvalStatus" = 'pending'`];
    const values: unknown[] = [];

    if (searchValue) {
      values.push(`%${searchValue}%`);
      where.push(
        `(u.name ILIKE $${values.length} OR u.email ILIKE $${values.length})`,
      );
    }

    if (platformRole !== 'superadmin') {
      values.push(activeOrganizationId);
      where.push(
        `EXISTS (SELECT 1 FROM member m WHERE m."userId" = u.id AND m."organizationId" = $${values.length})`,
      );
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const countValues = [...values];

    values.push(Math.max(0, Math.trunc(limit)));
    const limitParam = `$${values.length}`;
    values.push(Math.max(0, Math.trunc(offset)));
    const offsetParam = `$${values.length}`;

    const data = await this.db.query<UserRow>(
      `SELECT ${USER_LIST_COLUMNS}
       FROM "user" u ${whereSql}
       ORDER BY u."createdAt" DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      values,
    );

    const totalRow = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM "user" u ${whereSql}`,
      countValues,
    );

    return { data, total: totalRow ? parseInt(totalRow.count, 10) : 0 };
  }

  async findAcceptedInvitationByEmail(
    email: string,
  ): Promise<{ id: string } | null> {
    return this.db.queryOne<{ id: string }>(
      `SELECT id FROM invitation WHERE email = $1 AND status = 'accepted' LIMIT 1`,
      [email.toLowerCase()],
    );
  }

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

  async listRoles(): Promise<RoleMetaRow[]> {
    return this.db.query<RoleMetaRow>(
      'SELECT name, display_name, description, color, is_default FROM roles ORDER BY is_default DESC, name ASC',
    );
  }

  async listOrganizations(): Promise<OrgBasicRow[]> {
    return this.db.query<OrgBasicRow>(
      'SELECT id, name, slug FROM organization ORDER BY name ASC',
    );
  }

  async findOrganizationById(id: string): Promise<OrgBasicRow | null> {
    return this.db.queryOne<OrgBasicRow>(
      'SELECT id, name, slug FROM organization WHERE id = $1',
      [id],
    );
  }
}
