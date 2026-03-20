import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { EmailService } from '../../../../../shared/email/email.service';
import {
  PaginationQuery,
  UpdateOrganizationDto,
  Organization,
  OrganizationWithMemberCount,
  rowToOrganization,
} from '../../api/dto';
import { getAllowedRoleNamesForCreator, type PlatformRole } from '../../../utils/admin.utils';
import {
  type IAdminOrgRepository,
  ADMIN_ORG_REPOSITORY,
} from '../../domain/repositories/admin-org.repository.interface';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Role hierarchy: higher index = higher privilege.
 * Used to determine which roles a user can assign.
 */
export const ROLE_HIERARCHY: Record<string, number> = {
  member: 0,
  manager: 1,
  admin: 2,
  superadmin: 3,
};

/**
 * Returns the hierarchy level for a role name.
 * Unknown roles default to 0 (lowest).
 */
export function getRoleLevel(role: string): number {
  return ROLE_HIERARCHY[role] ?? 0;
}

/**
 * Filter roles to only those assignable by the given requester role.
 * A user can only assign roles at or below their own level.
 */
export function filterAssignableRoles(allRoleNames: string[], requesterRole: string): string[] {
  const requesterLevel = getRoleLevel(requesterRole);
  return allRoleNames.filter((r) => {
    const roleLevel = ROLE_HIERARCHY[r];
    return roleLevel !== undefined && roleLevel <= requesterLevel;
  });
}

/**
 * Service for platform-level organization management.
 * Allows platform admins to manage all organizations regardless of membership.
 */
@Injectable()
export class AdminOrganizationsService {
  constructor(
    @Inject(ADMIN_ORG_REPOSITORY) private readonly orgRepo: IAdminOrgRepository,
    private readonly emailService: EmailService,
  ) {}

  private readonly slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  private isSuperadminUserRole(role: string | null | undefined): boolean {
    return String(role ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .includes('superadmin');
  }

  /**
   * Get all roles from the database for organization membership.
   * When requesterRole is provided, assignableRoles is filtered to roles
   * at or below the requester's hierarchy level.
   */
  async getRoles(requesterRole?: string): Promise<{
    roles: Array<{ name: string; displayName: string; description: string | null; color: string | null; isSystem: boolean }>;
    assignableRoles: string[];
  }> {
    const rows = await this.orgRepo.getRoles();
    const uniqueRows = rows.filter(
      (row, index, items) => items.findIndex((candidate) => candidate.name === row.name) === index,
    );
    const allRoleNames = uniqueRows.map((r) => r.name);
    const assignableRoles = requesterRole
      ? filterAssignableRoles(allRoleNames, requesterRole)
      : allRoleNames;

    return {
      roles: uniqueRows.map((r) => ({
        name: r.name,
        displayName: r.display_name,
        description: r.description,
        color: r.color,
        isSystem: r.is_system,
      })),
      assignableRoles,
    };
  }

  /**
   * Create a new organization and add the creator as a member.
   */
  async create(
    input: {
      name: string;
      slug: string;
      logo?: string;
      metadata?: Record<string, unknown>;
    },
    actor: {
      id: string;
      platformRole: PlatformRole;
    },
  ): Promise<Organization> {
    const name = input.name.trim();
    const slug = input.slug.trim().toLowerCase();

    if (!name) {
      throw new BadRequestException('name is required');
    }

    if (!slug) {
      throw new BadRequestException('slug is required');
    }

    if (!this.slugRegex.test(slug)) {
      throw new BadRequestException('invalid slug');
    }

    const organizationId = this.generateId();
    const shouldCreateCreatorMembership = actor.platformRole !== 'superadmin';
    const memberId = shouldCreateCreatorMembership ? this.generateId() : undefined;
    const creatorMemberRole = shouldCreateCreatorMembership ? 'admin' : undefined;
    const metadataJson = input.metadata === undefined ? null : JSON.stringify(input.metadata);

    await this.orgRepo.createOrg({
      id: organizationId,
      name,
      slug,
      logo: input.logo ?? null,
      metadataJson,
      actorId: actor.id,
      actorRole: creatorMemberRole,
      memberId,
    });

    const row = await this.orgRepo.findById(organizationId);
    if (!row) {
      throw new InternalServerErrorException('Failed to create organization');
    }

    return rowToOrganization(row);
  }

  /**
   * List all organizations with pagination and search
   */
  async findAll(query: PaginationQuery): Promise<PaginatedResult<OrganizationWithMemberCount>> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const offset = (page - 1) * limit;
    const search = query.search?.trim() || undefined;

    const total = await this.orgRepo.countAll(search);
    const rows = await this.orgRepo.findAll(search, limit, offset);

    const data: OrganizationWithMemberCount[] = rows.map((row) => ({
      ...rowToOrganization(row),
      memberCount: parseInt(row.member_count, 10),
    }));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get a single organization by ID
   */
  async findById(id: string): Promise<OrganizationWithMemberCount | null> {
    const row = await this.orgRepo.findById(id);
    if (!row) return null;
    return {
      ...rowToOrganization(row),
      memberCount: parseInt(row.member_count, 10),
    };
  }

  /**
   * Update an organization
   */
  async update(id: string, dto: UpdateOrganizationDto): Promise<Organization | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const updates: Record<string, unknown> = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('name is required');
      updates.name = name;
    }

    if (dto.slug !== undefined) {
      const slug = dto.slug.trim().toLowerCase();
      if (!slug) throw new BadRequestException('slug is required');
      if (!this.slugRegex.test(slug)) throw new BadRequestException('invalid slug');
      updates.slug = slug;
    }

    if (dto.logo !== undefined) updates.logo = dto.logo;
    if (dto.metadata !== undefined) updates.metadataJson = JSON.stringify(dto.metadata);

    if (Object.keys(updates).length === 0) return existing;

    const row = await this.orgRepo.updateOrg(id, updates);
    return row ? rowToOrganization(row) : null;
  }

  /**
   * Delete an organization
   */
  async delete(id: string): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundException('Organization not found');
    await this.orgRepo.deleteOrg(id);
  }

  /**
   * Get members of an organization
   */
  async getMembers(organizationId: string): Promise<Array<{
    id: string;
    userId: string;
    role: string;
    createdAt: Date;
    user: {
      id: string;
      name: string;
      email: string;
      image: string | null;
    };
  }>> {
    const rows = await this.orgRepo.getMembers(organizationId);
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      role: row.role,
      createdAt: row.createdAt,
      user: {
        id: row.userId,
        name: row.user_name,
        email: row.user_email,
        image: row.user_image,
      },
    }));
  }

  async listMemberCandidates(
    organizationId: string,
    params: { search?: string; limit?: number } = {},
  ): Promise<Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    image: string | null;
  }>> {
    const org = await this.findById(organizationId);
    if (!org) throw new NotFoundException('Organization not found');

    return this.orgRepo.listMemberCandidates(organizationId, params);
  }

  /**
   * Create an invitation for an organization member.
   */
  async createInvitation(
    organizationId: string,
    email: string,
    role: 'admin' | 'manager' | 'member',
    platformRole: PlatformRole,
    inviter: { id: string; email: string; name?: string },
  ): Promise<{
    id: string;
    organizationId: string;
    email: string;
    role: string;
    status: string;
    expiresAt: Date;
    inviterId: string;
    createdAt: Date;
  }> {
    const normalizedEmail = email.trim().toLowerCase();

    const allowedRoleNames = getAllowedRoleNamesForCreator(platformRole);
    if (!allowedRoleNames.includes(role)) {
      throw new ForbiddenException('Role not allowed');
    }

    const organization = await this.orgRepo.findBasicById(organizationId);
    if (!organization) throw new NotFoundException('Organization not found');

    const existingMember = await this.orgRepo.findMemberByEmail(organizationId, normalizedEmail);
    if (existingMember) throw new BadRequestException('User is already a member of this organization');

    const existingInvitation = await this.orgRepo.findPendingInvitation(organizationId, normalizedEmail);
    if (existingInvitation) throw new ConflictException('Invitation already exists for this user');

    const invitationId = this.generateId();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitation = await this.orgRepo.createInvitation(
      invitationId, organizationId, normalizedEmail, role, expiresAt, inviter.id,
    );

    if (!invitation) {
      throw new InternalServerErrorException('Failed to create invitation');
    }

    try {
      await this.emailService.sendOrganizationInvitation({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        organizationId: invitation.organizationId,
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
        },
        inviter: {
          user: {
            id: inviter.id,
            email: inviter.email,
            name: inviter.name,
          },
        },
        expiresAt: invitation.expiresAt,
      });
    } catch (error) {
      console.error('Failed to send organization invitation email:', error);
    }

    return invitation;
  }

  /**
   * Get invitations for an organization
   */
  async getInvitations(organizationId: string): Promise<Array<{
    id: string;
    email: string;
    role: string;
    status: string;
    expiresAt: Date;
    createdAt: Date;
  }>> {
    return this.orgRepo.getInvitations(organizationId);
  }

  /**
   * Delete an invitation
   */
  async deleteInvitation(organizationId: string, invitationId: string): Promise<void> {
    const deleted = await this.orgRepo.deleteInvitation(invitationId, organizationId);
    if (!deleted) {
      const exists = await this.orgRepo.findInvitationById(invitationId);
      if (!exists) throw new NotFoundException('Invitation not found');
    }
  }

  /**
   * Add an existing user to an organization as a member
   */
  async addMember(
    organizationId: string,
    userId: string,
    role: string,
  ): Promise<{ id: string; organizationId: string; userId: string; role: string; createdAt: Date }> {
    const org = await this.findById(organizationId);
    if (!org) throw new NotFoundException('Organization not found');

    const user = await this.orgRepo.findUserById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (this.isSuperadminUserRole(user.role)) {
      throw new ForbiddenException('Superadmin users cannot be added as organization members');
    }

    const existingMember = await this.orgRepo.findMemberByUserId(userId, organizationId);
    if (existingMember) throw new ConflictException('User is already a member of this organization');

    const memberId = this.generateId();
    return this.orgRepo.addMember(memberId, organizationId, userId, role);
  }

  async updateMemberRole(
    organizationId: string,
    memberId: string,
    newRole: 'admin' | 'manager' | 'member',
    platformRole: PlatformRole,
  ): Promise<{
    id: string;
    organizationId: string;
    userId: string;
    role: string;
    createdAt: Date;
  }> {
    const allowedRoleNames = getAllowedRoleNamesForCreator(platformRole);
    if (!allowedRoleNames.includes(newRole)) {
      throw new ForbiddenException('Role not allowed');
    }

    const member = await this.orgRepo.findMemberById(memberId, organizationId);
    if (!member) throw new NotFoundException('Member not found');

    if (platformRole !== 'superadmin' && platformRole !== 'admin' && member.role !== 'member') {
      throw new ForbiddenException('Organization-scoped actors can only change member roles');
    }

    if (member.role === 'admin' && newRole !== 'admin') {
      const adminCount = await this.orgRepo.countAdmins(organizationId);
      if (adminCount <= 1) throw new ForbiddenException('Cannot change role of the last organization admin');
    }

    const updated = await this.orgRepo.updateMemberRole(memberId, organizationId, newRole);
    if (!updated) throw new NotFoundException(`Member ${memberId} not found in organization ${organizationId}`);
    return updated;
  }

  async removeMember(
    organizationId: string,
    memberId: string,
    platformRole: PlatformRole,
  ): Promise<{ success: true }> {
    const member = await this.orgRepo.findMemberById(memberId, organizationId);
    if (!member) throw new NotFoundException('Member not found');

    if (platformRole !== 'superadmin' && platformRole !== 'admin' && member.role !== 'member') {
      throw new ForbiddenException('Organization-scoped actors can only remove members');
    }

    if (member.role === 'admin') {
      const adminCount = await this.orgRepo.countAdmins(organizationId);
      if (adminCount <= 1) throw new ForbiddenException('Cannot remove the last organization admin');
    }

    const removed = await this.orgRepo.removeMember(memberId, organizationId);
    if (!removed) throw new NotFoundException('Member not found');

    return { success: true };
  }

  private generateId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}
