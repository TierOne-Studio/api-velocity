import { ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { DatabaseService } from '../../../../../../shared/infrastructure/database/database.module';
import type {
  IAdminOrgRepository,
  OrgWithCountRow,
  OrgRawRow,
  OrgBasicRow,
  MemberWithUserRow,
  MemberCandidateRow,
  MemberRow,
  MemberBasicRow,
  InvitationRow,
  RoleRow,
  CreateOrgParams,
  UpdateOrgFields,
} from '../../../domain/repositories/admin-org.repository.interface';

@Injectable()
export class AdminOrgDatabaseRepository implements IAdminOrgRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAll(search?: string, limit = 20, offset = 0): Promise<OrgWithCountRow[]> {
    let whereClause = '';
    const params: unknown[] = [];
    if (search) {
      whereClause = 'WHERE o.name ILIKE $1 OR o.slug ILIKE $1';
      params.push(`%${search}%`);
    }
    const limitParam = params.length + 1;
    const offsetParam = params.length + 2;
    return this.db.query<OrgWithCountRow>(
      `SELECT o.*, COUNT(m.id) as member_count
       FROM organization o
       LEFT JOIN member m ON m."organizationId" = o.id
       ${whereClause}
       GROUP BY o.id
       ORDER BY o."createdAt" DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, limit, offset],
    );
  }

  async countAll(search?: string): Promise<number> {
    let whereClause = '';
    const params: unknown[] = [];
    if (search) {
      whereClause = 'WHERE o.name ILIKE $1 OR o.slug ILIKE $1';
      params.push(`%${search}%`);
    }
    const result = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM organization o ${whereClause}`,
      params,
    );
    return parseInt(result?.count ?? '0', 10);
  }

  async findById(id: string): Promise<OrgWithCountRow | null> {
    return this.db.queryOne<OrgWithCountRow>(
      `SELECT o.*, COUNT(m.id) as member_count
       FROM organization o
       LEFT JOIN member m ON m."organizationId" = o.id
       WHERE o.id = $1
       GROUP BY o.id`,
      [id],
    );
  }

  async findBasicById(id: string): Promise<OrgBasicRow | null> {
    return this.db.queryOne<OrgBasicRow>(
      'SELECT id, name, slug FROM organization WHERE id = $1',
      [id],
    );
  }

  async findBySlug(slug: string): Promise<{ id: string } | null> {
    return this.db.queryOne<{ id: string }>(
      'SELECT id FROM organization WHERE LOWER(slug) = LOWER($1)',
      [slug],
    );
  }

  async createOrg(params: CreateOrgParams): Promise<void> {
    await this.db.transaction(async (query) => {
      try {
        await query(
          `INSERT INTO organization (id, name, slug, logo, "createdAt", metadata)
           VALUES ($1, $2, $3, $4, NOW(), $5)`,
          [params.id, params.name, params.slug, params.logo, params.metadataJson],
        );
      } catch (err: unknown) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException('Organization slug already exists');
        }
        throw err;
      }

      await query(
        `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
         VALUES ($1, $2, $3, $4, NOW())`,
        [params.memberId, params.id, params.actorId, params.actorRole],
      );
    });
  }

  async updateOrg(id: string, updates: UpdateOrgFields): Promise<OrgRawRow | null> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.slug !== undefined) {
      setClauses.push(`slug = $${paramIndex++}`);
      values.push(updates.slug);
    }
    if (updates.logo !== undefined) {
      setClauses.push(`logo = $${paramIndex++}`);
      values.push(updates.logo);
    }
    if (updates.metadataJson !== undefined) {
      setClauses.push(`metadata = $${paramIndex++}`);
      values.push(updates.metadataJson);
    }

    if (setClauses.length === 0) return null;

    values.push(id);
    return this.db.queryOne<OrgRawRow>(
      `UPDATE organization SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values,
    );
  }

  async deleteOrg(id: string): Promise<void> {
    await this.db.transaction(async (query) => {
      await query('DELETE FROM invitation WHERE "organizationId" = $1', [id]);
      await query('DELETE FROM member WHERE "organizationId" = $1', [id]);
      await query('DELETE FROM organization WHERE id = $1', [id]);
    });
  }

  async getMembers(organizationId: string): Promise<MemberWithUserRow[]> {
    return this.db.query<MemberWithUserRow>(
      `SELECT m.id, m."userId", m.role, m."createdAt",
              u.name as user_name, u.email as user_email, u.image as user_image
       FROM member m
       JOIN "user" u ON u.id = m."userId"
       WHERE m."organizationId" = $1
       ORDER BY m."createdAt" ASC`,
      [organizationId],
    );
  }

  async listMemberCandidates(
    organizationId: string,
    params: { search?: string; limit?: number } = {},
  ): Promise<MemberCandidateRow[]> {
    const limit = Math.min(100, Math.max(1, params.limit ?? 25));
    const queryParams: unknown[] = [organizationId];
    let searchClause = '';

    if (params.search?.trim()) {
      queryParams.push(`%${params.search.trim()}%`);
      const searchParam = queryParams.length;
      searchClause = `
       AND (
         u.name ILIKE $${searchParam}
         OR u.email ILIKE $${searchParam}
       )`;
    }

    queryParams.push(limit);
    const limitParam = queryParams.length;

    return this.db.query<MemberCandidateRow>(
      `SELECT u.id, u.name, u.email, u.role, u.image
       FROM "user" u
       WHERE NOT EXISTS (
         SELECT 1
         FROM member m
         WHERE m."organizationId" = $1
           AND m."userId" = u.id
       )
       ${searchClause}
       ORDER BY u.name ASC, u.email ASC
       LIMIT $${limitParam}`,
      queryParams,
    );
  }

  async findMemberById(memberId: string, organizationId: string): Promise<MemberBasicRow | null> {
    return this.db.queryOne<MemberBasicRow>(
      'SELECT id, role, "userId" as "userId" FROM member WHERE id = $1 AND "organizationId" = $2',
      [memberId, organizationId],
    );
  }

  async findMemberByUserId(userId: string, organizationId: string): Promise<{ id: string } | null> {
    return this.db.queryOne<{ id: string }>(
      'SELECT id FROM member WHERE "userId" = $1 AND "organizationId" = $2',
      [userId, organizationId],
    );
  }

  async findMemberByEmail(organizationId: string, email: string): Promise<{ id: string } | null> {
    return this.db.queryOne<{ id: string }>(
      `SELECT m.id
       FROM member m
       JOIN "user" u ON u.id = m."userId"
       WHERE m."organizationId" = $1 AND LOWER(u.email) = LOWER($2)`,
      [organizationId, email],
    );
  }

  async countAdmins(organizationId: string): Promise<number> {
    const result = await this.db.queryOne<{ count: string }>(
      'SELECT COUNT(*)::text as count FROM member WHERE "organizationId" = $1 AND role = $2',
      [organizationId, 'admin'],
    );
    return result ? parseInt(result.count, 10) : 0;
  }

  async addMember(id: string, organizationId: string, userId: string, role: string): Promise<MemberRow> {
    await this.db.query(
      `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
       VALUES ($1, $2, $3, $4, NOW())`,
      [id, organizationId, userId, role],
    );
    const member = await this.db.queryOne<MemberRow>(
      'SELECT id, "organizationId", "userId", role, "createdAt" FROM member WHERE id = $1',
      [id],
    );
    if (!member) throw new InternalServerErrorException(`Failed to retrieve member ${id} after insert into organization ${organizationId}`);
    return member;
  }

  async updateMemberRole(memberId: string, organizationId: string, role: string): Promise<MemberRow | null> {
    await this.db.query(
      'UPDATE member SET role = $1 WHERE id = $2 AND "organizationId" = $3',
      [role, memberId, organizationId],
    );
    return this.db.queryOne<MemberRow>(
      'SELECT id, "organizationId" as "organizationId", "userId" as "userId", role, "createdAt" as "createdAt" FROM member WHERE id = $1 AND "organizationId" = $2',
      [memberId, organizationId],
    );
  }

  async removeMember(memberId: string, organizationId: string): Promise<boolean> {
    const result = await this.db.query<{ id: string }>(
      'DELETE FROM member WHERE id = $1 AND "organizationId" = $2 RETURNING id',
      [memberId, organizationId],
    );
    return result.length > 0;
  }

  async findUserById(userId: string): Promise<{ id: string } | null> {
    return this.db.queryOne<{ id: string }>(
      'SELECT id FROM "user" WHERE id = $1',
      [userId],
    );
  }

  async findPendingInvitation(organizationId: string, email: string): Promise<{ id: string } | null> {
    return this.db.queryOne<{ id: string }>(
      'SELECT id FROM invitation WHERE "organizationId" = $1 AND LOWER(email) = LOWER($2) AND status = $3',
      [organizationId, email, 'pending'],
    );
  }

  async findInvitationById(invitationId: string): Promise<{ id: string } | null> {
    return this.db.queryOne<{ id: string }>(
      'SELECT id FROM invitation WHERE id = $1',
      [invitationId],
    );
  }

  async createInvitation(
    id: string,
    organizationId: string,
    email: string,
    role: string,
    expiresAt: Date,
    inviterId: string,
  ): Promise<InvitationRow> {
    await this.db.query(
      `INSERT INTO invitation (id, "organizationId", email, role, status, "expiresAt", "inviterId", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [id, organizationId, email, role, 'pending', expiresAt, inviterId],
    );
    const invitation = await this.db.queryOne<InvitationRow>(
      'SELECT id, "organizationId" as "organizationId", email, role, status, "expiresAt" as "expiresAt", "inviterId" as "inviterId", "createdAt" as "createdAt" FROM invitation WHERE id = $1',
      [id],
    );
    if (!invitation) throw new InternalServerErrorException(`Failed to retrieve invitation ${id} after insert into organization ${organizationId}`);
    return invitation;
  }

  async getInvitations(organizationId: string): Promise<InvitationRow[]> {
    return this.db.query<InvitationRow>(
      `SELECT id, "organizationId", email, role, status, "expiresAt", "inviterId", "createdAt"
       FROM invitation
       WHERE "organizationId" = $1
       ORDER BY "createdAt" DESC`,
      [organizationId],
    );
  }

  async deleteInvitation(invitationId: string, organizationId: string): Promise<boolean> {
    const result = await this.db.query<{ id: string }>(
      'DELETE FROM invitation WHERE id = $1 AND "organizationId" = $2 RETURNING id',
      [invitationId, organizationId],
    );
    return result.length > 0;
  }

  async getRoles(): Promise<RoleRow[]> {
    return this.db.query<RoleRow>(
      'SELECT name, display_name, description, color, is_system FROM roles ORDER BY is_system DESC, name ASC',
    );
  }
}
