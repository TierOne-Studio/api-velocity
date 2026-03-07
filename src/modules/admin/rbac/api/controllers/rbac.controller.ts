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
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { RolesGuard, Roles, PermissionsGuard, RequirePermissions } from '../../../../../shared';
import { RoleService, PermissionService } from '../../application/services';
import { CreateRoleDto, UpdateRoleDto, AssignPermissionsDto } from '../dto';

/**
 * Controller for RBAC management endpoints
 */
@Controller('api/rbac')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles('admin', 'manager')
export class RbacController {
  constructor(
    private readonly roleService: RoleService,
    private readonly permissionService: PermissionService,
  ) {}

  private validateCreateRolePayload(dto: CreateRoleDto): void {
    if (!dto?.name?.trim()) {
      throw new HttpException('Role name is required', HttpStatus.BAD_REQUEST);
    }
    if (!dto?.displayName?.trim()) {
      throw new HttpException('Role displayName is required', HttpStatus.BAD_REQUEST);
    }
  }

  private validateUpdateRolePayload(dto: UpdateRoleDto): void {
    const hasAnyField =
      dto.displayName !== undefined ||
      dto.description !== undefined ||
      dto.color !== undefined;

    if (!hasAnyField) {
      throw new HttpException('At least one field is required to update a role', HttpStatus.BAD_REQUEST);
    }
  }

  private validateAssignPermissionsPayload(dto: AssignPermissionsDto): void {
    if (!Array.isArray(dto?.permissionIds)) {
      throw new HttpException('permissionIds must be an array', HttpStatus.BAD_REQUEST);
    }
  }

  // ============ My Permissions ============

  /**
   * Get the current authenticated user's effective permissions.
   * Admin users receive all permissions; others receive their DB role_permissions.
   * Accessible by any authenticated admin/manager (class-level @Roles already enforces this).
   */
  @Get('my-permissions')
  async getMyPermissions(@Session() session: UserSession) {
    const userRole = session?.user?.role as string;

    if (userRole === 'admin') {
      const allPermissions = await this.permissionService.findAll();
      return {
        data: allPermissions.map((p) => `${p.resource}:${p.action}`),
      };
    }

    const permissions = await this.roleService.getUserPermissions(userRole);
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
  async getRoles() {
    const roles = await this.roleService.findAll();
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
  async createRole(@Body() dto: CreateRoleDto) {
    this.validateCreateRolePayload(dto);

    // Check if role name already exists
    const existing = await this.roleService.findByName(dto.name);
    if (existing) {
      throw new HttpException('Role name already exists', HttpStatus.CONFLICT);
    }

    const role = await this.roleService.create(dto);
    return { data: role };
  }

  /**
   * Update a role
   */
  @Put('roles/:id')
  @RequirePermissions('role:update')
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    this.validateUpdateRolePayload(dto);

    const role = await this.roleService.update(id, dto);
    if (!role) {
      throw new HttpException('Role not found', HttpStatus.NOT_FOUND);
    }
    return { data: role };
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
        if (error.message === 'Cannot delete system role') {
          throw new HttpException(error.message, HttpStatus.FORBIDDEN);
        }
        if (error.message === 'Role not found') {
          throw new HttpException(error.message, HttpStatus.NOT_FOUND);
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
  async getUserPermissions(@Param('roleName') roleName: string) {
    const permissions = await this.roleService.getUserPermissions(roleName);
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
