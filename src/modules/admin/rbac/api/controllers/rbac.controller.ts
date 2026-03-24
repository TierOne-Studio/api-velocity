import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
  UseGuards,
  ForbiddenException,
  Query,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PermissionsGuard, RequirePermissions } from '../../../../../shared';
import { RoleService, PermissionService } from '../../application/services';
import { CreateRoleDto, UpdateRoleDto, AssignPermissionsDto } from '../dto';
import { getActiveOrganizationId, getPlatformRole } from '../../../utils/admin.utils';

/**
 * Controller for RBAC management endpoints
 */
@Controller('api/rbac')
@UseGuards(PermissionsGuard)
export class RbacController {
  constructor(
    private readonly roleService: RoleService,
    private readonly permissionService: PermissionService,
  ) {}

  private validateCreateRolePayload(dto: CreateRoleDto): void {
    const normalizedName = dto?.name?.trim().toLowerCase();
    const reservedNames = new Set(['superadmin', 'user']);

    if (!normalizedName) {
      throw new HttpException('Role name is required', HttpStatus.BAD_REQUEST);
    }
    if (reservedNames.has(normalizedName)) {
      throw new HttpException(`Role name ${normalizedName} is reserved`, HttpStatus.BAD_REQUEST);
    }
    if (!dto?.displayName?.trim()) {
      throw new HttpException('Role displayName is required', HttpStatus.BAD_REQUEST);
    }
  }

  private validateUpdateRolePayload(dto: UpdateRoleDto): void {
    const normalizedName = dto.name?.trim().toLowerCase();
    const reservedNames = new Set(['superadmin', 'user']);
    const hasAnyField =
      normalizedName !== undefined ||
      dto.displayName !== undefined ||
      dto.description !== undefined ||
      dto.color !== undefined;

    if (!hasAnyField) {
      throw new HttpException('At least one field is required to update a role', HttpStatus.BAD_REQUEST);
    }

    if (normalizedName !== undefined && !normalizedName) {
      throw new HttpException('Role name is required', HttpStatus.BAD_REQUEST);
    }

    if (normalizedName && reservedNames.has(normalizedName)) {
      throw new HttpException(`Role name ${normalizedName} is reserved`, HttpStatus.BAD_REQUEST);
    }
  }

  private validateAssignPermissionsPayload(dto: AssignPermissionsDto): void {
    if (!Array.isArray(dto?.permissionIds)) {
      throw new HttpException('permissionIds must be an array', HttpStatus.BAD_REQUEST);
    }
  }

  private resolveTargetOrganizationId(session: UserSession, organizationId?: string): string {
    const platformRole = getPlatformRole(session);

    if (platformRole === 'superadmin') {
      if (!organizationId?.trim()) {
        throw new HttpException('organizationId is required for superadmin role management', HttpStatus.BAD_REQUEST);
      }

      return organizationId.trim();
    }

    const activeOrganizationId = getActiveOrganizationId(session);
    if (!activeOrganizationId) {
      throw new HttpException('Active organization required', HttpStatus.FORBIDDEN);
    }

    return activeOrganizationId;
  }

  private resolveRoleListOrganizationId(session: UserSession, organizationId?: string): string | null {
    const platformRole = getPlatformRole(session);

    if (platformRole === 'superadmin') {
      const trimmedOrganizationId = organizationId?.trim();
      return trimmedOrganizationId ? trimmedOrganizationId : null;
    }

    const activeOrganizationId = getActiveOrganizationId(session);
    if (!activeOrganizationId) {
      throw new HttpException('Active organization required', HttpStatus.FORBIDDEN);
    }

    return activeOrganizationId;
  }

  // ============ My Permissions ============

  /**
   * Get the current authenticated user's effective permissions.
   * Superadmin users receive all permissions; others receive their active-org role permissions.
   */
  @Get('my-permissions')
  async getMyPermissions(@Session() session: UserSession) {
    if (!session?.user) {
      throw new ForbiddenException('Authentication required');
    }

    const userRole = getPlatformRole(session);
    const activeOrganizationId = getActiveOrganizationId(session);

    if (userRole === 'superadmin') {
      const allPermissions = await this.permissionService.findAll();
      return {
        data: allPermissions.map((p) => `${p.resource}:${p.action}`),
      };
    }

    // Non-superadmins derive permissions solely from their org membership role.
    // Without an active org there is no membership context → return empty.
    if (!activeOrganizationId) {
      return { data: [] };
    }

    // user.role is NULL for non-superadmins after Phase 0 migration; resolve actual org membership role
    let effectiveRole: string = userRole;
    if (session.user.id) {
      const memberRole = await this.roleService.getUserActiveMemberRole(session.user.id, activeOrganizationId);
      if (memberRole) effectiveRole = memberRole;
    }

    const permissions = await this.roleService.getUserPermissions(effectiveRole, activeOrganizationId);
    return {
      data: permissions.map((p) => `${p.resource}:${p.action}`),
    };
  }

  // ============ Roles ============

  /**
   * Get all roles
   */
  @Get('roles')
  @RequirePermissions('role:read')
  async getRoles(
    @Session() session: UserSession,
    @Query('organizationId') organizationId?: string,
  ) {
    const targetOrganizationId = this.resolveRoleListOrganizationId(session, organizationId);
    const roles = await this.roleService.findAll(targetOrganizationId);
    return { data: roles };
  }

  /**
   * Get role by ID with permissions
   */
  @Get('roles/:id')
  @RequirePermissions('role:read')
  async getRole(@Param('id') id: string) {
    const role = await this.roleService.findById(id);
    if (!role) {
      throw new HttpException('Role not found', HttpStatus.NOT_FOUND);
    }
    const permissions = await this.roleService.getPermissions(id);
    return { data: { ...role, permissions } };
  }

  /**
   * Create a new role
   */
  @Post('roles')
  @RequirePermissions('role:create')
  async createRole(
    @Session() session: UserSession,
    @Body() dto: CreateRoleDto,
    @Query('organizationId') organizationId?: string,
  ) {
    this.validateCreateRolePayload(dto);
    dto.name = dto.name.trim().toLowerCase();
    const targetOrganizationId = this.resolveTargetOrganizationId(session, organizationId);

    // Check if role name already exists
    const existing = await this.roleService.findByNameInOrganization(dto.name, targetOrganizationId);
    if (existing) {
      throw new HttpException('Role name already exists', HttpStatus.CONFLICT);
    }

    const role = await this.roleService.create(dto, targetOrganizationId);
    return { data: role };
  }

  /**
   * Update a role
   */
  @Put('roles/:id')
  @RequirePermissions('role:update')
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    this.validateUpdateRolePayload(dto);

    try {
      const role = await this.roleService.update(id, dto);
      if (!role) {
        throw new HttpException('Role not found', HttpStatus.NOT_FOUND);
      }
      return { data: role };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Cannot rename global role') {
          throw new HttpException(error.message, HttpStatus.FORBIDDEN);
        }
        if (error.message === 'Role name already exists') {
          throw new HttpException(error.message, HttpStatus.CONFLICT);
        }
      }
      throw error;
    }
  }

  /**
   * Delete a role
   */
  @Delete('roles/:id')
  @RequirePermissions('role:delete')
  async deleteRole(@Param('id') id: string) {
    try {
      await this.roleService.delete(id);
      return { success: true };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Cannot delete global role') {
          throw new HttpException(error.message, HttpStatus.FORBIDDEN);
        }
        if (error.message === 'Role not found') {
          throw new HttpException(error.message, HttpStatus.NOT_FOUND);
        }
        if (error.message === 'Role is still assigned and cannot be deleted') {
          throw new HttpException(error.message, HttpStatus.CONFLICT);
        }
      }
      throw error;
    }
  }

  /**
   * Assign permissions to a role
   */
  @Put('roles/:id/permissions')
  @RequirePermissions('role:assign')
  async assignPermissions(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto,
  ) {
    this.validateAssignPermissionsPayload(dto);

    const role = await this.roleService.findById(id);
    if (!role) {
      throw new HttpException('Role not found', HttpStatus.NOT_FOUND);
    }

    await this.roleService.assignPermissions(id, dto.permissionIds);
    const permissions = await this.roleService.getPermissions(id);
    return { data: { ...role, permissions } };
  }

  // ============ Permissions ============

  /**
   * Get all permissions
   */
  @Get('permissions')
  @RequirePermissions('role:read')
  async getPermissions() {
    const permissions = await this.permissionService.findAll();
    return { data: permissions };
  }

  /**
   * Get permissions grouped by resource
   */
  @Get('permissions/grouped')
  @RequirePermissions('role:read')
  async getPermissionsGrouped() {
    const grouped = await this.permissionService.findGroupedByResource();
    return { data: grouped };
  }

  // ============ User Permissions ============

  /**
   * Get effective permissions for a user based on their role
   */
  @Get('users/:roleName/permissions')
  @RequirePermissions('role:read')
  async getUserPermissions(@Session() session: UserSession, @Param('roleName') roleName: string) {
    const permissions = await this.roleService.getUserPermissions(
      roleName,
      getActiveOrganizationId(session),
    );
    return { data: permissions };
  }

  /**
   * Check if a role has a specific permission
   */
  @Get('check/:roleName/:resource/:action')
  @RequirePermissions('role:read')
  async checkPermission(
    @Param('roleName') roleName: string,
    @Param('resource') resource: string,
    @Param('action') action: string,
  ) {
    const hasPermission = await this.roleService.hasPermission(
      roleName,
      resource,
      action,
    );
    return { data: { hasPermission } };
  }
}
