import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  HttpException,
  HttpStatus,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { RolesGuard, Roles, PermissionsGuard, RequirePermissions } from '../../../../../shared';
import { AdminOrganizationsService, filterAssignableRoles, getRoleLevel } from '../../application/services/admin-organizations.service';
import { PaginationQuery, UpdateOrganizationDto } from '../../api/dto';

/**
 * Controller for platform-level organization management.
 * Admins can manage all organizations.
 * Managers can only view and manage their active organization.
 */
@Controller('api/platform-admin/organizations')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles('admin', 'manager')
export class AdminOrganizationsController {
  constructor(private readonly orgService: AdminOrganizationsService) {}

  private readonly allowedMemberRoles = ['admin', 'manager', 'member'] as const;
  private readonly slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  private getSessionInfo(session: UserSession): { role: 'admin' | 'manager'; activeOrgId: string | null } {
    const role = session?.user?.role as string;
    const activeOrgId = (session?.session as { activeOrganizationId?: string })?.activeOrganizationId ?? null;
    return {
      role: role === 'admin' ? 'admin' : 'manager',
      activeOrgId,
    };
  }

  private requireActiveOrgForManager(role: 'admin' | 'manager', activeOrgId: string | null): void {
    if (role === 'manager' && !activeOrgId) {
      throw new ForbiddenException('Active organization required');
    }
  }

  private assertManagerCanAccessOrg(role: 'admin' | 'manager', activeOrgId: string | null, targetOrgId: string): void {
    if (role === 'manager' && activeOrgId !== targetOrgId) {
      throw new ForbiddenException('You can only access your own organization');
    }
  }

  private validateAddMemberPayload(body: { userId: string; role: string }): void {
    if (!body?.userId?.trim()) {
      throw new HttpException('userId is required', HttpStatus.BAD_REQUEST);
    }

    if (!body?.role || !this.allowedMemberRoles.includes(body.role as (typeof this.allowedMemberRoles)[number])) {
      throw new HttpException('invalid role', HttpStatus.BAD_REQUEST);
    }
  }

  private validateUpdateMemberRolePayload(body: { role: string }): void {
    if (!body?.role || !this.allowedMemberRoles.includes(body.role as (typeof this.allowedMemberRoles)[number])) {
      throw new HttpException('invalid role', HttpStatus.BAD_REQUEST);
    }
  }

  private validateCreateInvitationPayload(body: { email: string; role: string }): void {
    if (!body?.email?.trim()) {
      throw new HttpException('email is required', HttpStatus.BAD_REQUEST);
    }

    if (!body.email.includes('@')) {
      throw new HttpException('invalid email', HttpStatus.BAD_REQUEST);
    }

    if (!body?.role || !this.allowedMemberRoles.includes(body.role as (typeof this.allowedMemberRoles)[number])) {
      throw new HttpException('invalid role', HttpStatus.BAD_REQUEST);
    }
  }

  private validateCreateOrganizationPayload(body: {
    name?: string;
    slug?: string;
    logo?: string;
    metadata?: Record<string, unknown>;
  }): void {
    const name = body?.name?.trim();
    const slug = body?.slug?.trim().toLowerCase();

    if (!name) {
      throw new HttpException('name is required', HttpStatus.BAD_REQUEST);
    }

    if (!slug) {
      throw new HttpException('slug is required', HttpStatus.BAD_REQUEST);
    }

    if (!this.slugRegex.test(slug)) {
      throw new HttpException('invalid slug', HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * Create a new organization.
   * Managers can create organizations only when explicitly granted organization:create.
   */
  @Post()
  @RequirePermissions('organization:create')
  async create(
    @Session() session: UserSession,
    @Body() body: { name: string; slug: string; logo?: string; metadata?: Record<string, unknown> },
  ) {
    this.validateCreateOrganizationPayload(body);
    const { role } = this.getSessionInfo(session);

    const org = await this.orgService.create(
      {
        name: body.name,
        slug: body.slug,
        logo: body.logo,
        metadata: body.metadata,
      },
      {
        id: session.user.id,
        platformRole: role,
      },
    );

    return { data: org };
  }

  /**
   * Get organization membership roles metadata
   * Returns the available roles from the database
   */
  @Get('roles-metadata')
  @RequirePermissions('organization:read')
  async getRolesMetadata(@Session() session: UserSession) {
    const { role } = this.getSessionInfo(session);
    return this.orgService.getRoles(role);
  }

  /**
   * List organizations with pagination and search
   * Admins see all organizations, managers only see their active organization
   */
  @Get()
  @RequirePermissions('organization:read')
  async list(@Session() session: UserSession, @Query() query: PaginationQuery) {
    const { role, activeOrgId } = this.getSessionInfo(session);
    this.requireActiveOrgForManager(role, activeOrgId);

    const page = query.page ? parseInt(String(query.page), 10) : 1;
    const limit = query.limit ? parseInt(String(query.limit), 10) : 20;
    const search = query.search;

    // Managers only see their own organization
    if (role === 'manager' && activeOrgId) {
      const org = await this.orgService.findById(activeOrgId);
      return {
        data: org ? [org] : [],
        pagination: { page: 1, limit: 1, total: org ? 1 : 0, totalPages: 1 },
      };
    }

    const result = await this.orgService.findAll({ page, limit, search });
    return result;
  }

  /**
   * Get a single organization by ID
   */
  @Get(':id')
  @RequirePermissions('organization:read')
  async findOne(@Session() session: UserSession, @Param('id') id: string) {
    const { role, activeOrgId } = this.getSessionInfo(session);
    this.requireActiveOrgForManager(role, activeOrgId);
    this.assertManagerCanAccessOrg(role, activeOrgId, id);

    const org = await this.orgService.findById(id);
    if (!org) {
      throw new HttpException('Organization not found', HttpStatus.NOT_FOUND);
    }
    return { data: org };
  }

  /**
   * Get members of an organization
   */
  @Get(':id/members')
  @RequirePermissions('organization:read')
  async getMembers(@Session() session: UserSession, @Param('id') id: string) {
    const { role, activeOrgId } = this.getSessionInfo(session);
    this.requireActiveOrgForManager(role, activeOrgId);
    this.assertManagerCanAccessOrg(role, activeOrgId, id);

    const org = await this.orgService.findById(id);
    if (!org) {
      throw new HttpException('Organization not found', HttpStatus.NOT_FOUND);
    }
    const members = await this.orgService.getMembers(id);
    return { data: members };
  }

  /**
   * Get invitations for an organization
   */
  @Get(':id/invitations')
  @RequirePermissions('organization:read')
  async getInvitations(@Session() session: UserSession, @Param('id') id: string) {
    const { role, activeOrgId } = this.getSessionInfo(session);
    this.requireActiveOrgForManager(role, activeOrgId);
    this.assertManagerCanAccessOrg(role, activeOrgId, id);

    const org = await this.orgService.findById(id);
    if (!org) {
      throw new HttpException('Organization not found', HttpStatus.NOT_FOUND);
    }
    const invitations = await this.orgService.getInvitations(id);
    return { data: invitations };
  }

  /**
   * Create invitation for organization.
   */
  @Post(':id/invitations')
  @RequirePermissions('organization:invite')
  async createInvitation(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() body: { email: string; role: 'admin' | 'manager' | 'member' },
  ) {
    this.validateCreateInvitationPayload(body);

    const { role, activeOrgId } = this.getSessionInfo(session);
    this.requireActiveOrgForManager(role, activeOrgId);
    this.assertManagerCanAccessOrg(role, activeOrgId, id);

    const invitation = await this.orgService.createInvitation(
      id,
      body.email,
      body.role,
      role,
      {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      },
    );

    return { data: invitation };
  }

  /**
   * Delete an invitation
   */
  @Delete(':orgId/invitations/:invitationId')
  @RequirePermissions('organization:invite')
  async deleteInvitation(
    @Session() session: UserSession,
    @Param('orgId') orgId: string,
    @Param('invitationId') invitationId: string,
  ) {
    const { role, activeOrgId } = this.getSessionInfo(session);
    this.requireActiveOrgForManager(role, activeOrgId);
    this.assertManagerCanAccessOrg(role, activeOrgId, orgId);

    await this.orgService.deleteInvitation(orgId, invitationId);
    return { success: true };
  }

  /**
   * Add an existing user to an organization as a member
   */
  @Post(':id/members')
  @RequirePermissions('organization:invite')
  async addMember(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() body: { userId: string; role: string },
  ) {
    this.validateAddMemberPayload(body);

    const { role, activeOrgId } = this.getSessionInfo(session);
    this.requireActiveOrgForManager(role, activeOrgId);
    this.assertManagerCanAccessOrg(role, activeOrgId, id);

    // Validate that the requester can assign the requested role
    const requestedRoleLevel = getRoleLevel(body.role);
    const requesterRoleLevel = getRoleLevel(role);
    if (requestedRoleLevel > requesterRoleLevel) {
      throw new ForbiddenException(
        `Cannot assign role '${body.role}' — exceeds your permission level`,
      );
    }

    const org = await this.orgService.findById(id);
    if (!org) {
      throw new HttpException('Organization not found', HttpStatus.NOT_FOUND);
    }
    const member = await this.orgService.addMember(id, body.userId, body.role);
    return { data: member };
  }

  /**
   * Update a member role in an organization.
   */
  @Put(':id/members/:memberId/role')
  @RequirePermissions('organization:invite')
  async updateMemberRole(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() body: { role: 'admin' | 'manager' | 'member' },
  ) {
    this.validateUpdateMemberRolePayload(body);

    const { role, activeOrgId } = this.getSessionInfo(session);
    this.requireActiveOrgForManager(role, activeOrgId);
    this.assertManagerCanAccessOrg(role, activeOrgId, id);

    const updated = await this.orgService.updateMemberRole(id, memberId, body.role, role);
    return { data: updated };
  }

  /**
   * Remove a member from an organization.
   */
  @Delete(':id/members/:memberId')
  @RequirePermissions('organization:invite')
  async removeMember(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
  ) {
    const { role, activeOrgId } = this.getSessionInfo(session);
    this.requireActiveOrgForManager(role, activeOrgId);
    this.assertManagerCanAccessOrg(role, activeOrgId, id);

    return this.orgService.removeMember(id, memberId, role);
  }

  /**
   * Update an organization
   */
  @Put(':id')
  @RequirePermissions('organization:update')
  async update(@Session() session: UserSession, @Param('id') id: string, @Body() dto: UpdateOrganizationDto) {
    const { role, activeOrgId } = this.getSessionInfo(session);
    this.requireActiveOrgForManager(role, activeOrgId);
    this.assertManagerCanAccessOrg(role, activeOrgId, id);

    const org = await this.orgService.update(id, dto);
    if (!org) {
      throw new HttpException('Organization not found', HttpStatus.NOT_FOUND);
    }
    return { data: org };
  }

  /**
   * Delete an organization
   */
  @Delete(':id')
  @RequirePermissions('organization:delete')
  async delete(@Session() session: UserSession, @Param('id') id: string) {
    const { role, activeOrgId } = this.getSessionInfo(session);
    this.requireActiveOrgForManager(role, activeOrgId);
    this.assertManagerCanAccessOrg(role, activeOrgId, id);
    try {
      await this.orgService.delete(id);
      return { success: true };
    } catch (error) {
      if (error instanceof Error && error.message === 'Organization not found') {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw error;
    }
  }
}
