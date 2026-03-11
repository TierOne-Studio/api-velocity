import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Query,
  Param,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { AdminService } from '../../application/services';
import { OrgImpersonationService } from '../../../organizations/application/services';
import {
  requireAdminOrManager,
  requireActiveOrganizationIdForManager,
} from '../../utils/admin.utils';
import { RolesGuard, Roles, PermissionsGuard, RequirePermissions } from '../../../../../shared';
import { PASSWORD_POLICY } from '../../../../../shared/utils/password-policy';

@Controller('api/admin/users')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles('admin', 'manager')
export class AdminUsersController {
  constructor(
    private readonly adminService: AdminService,
    private readonly impersonationService: OrgImpersonationService,
  ) {}

  private validatePagination(limit: string, offset: string): { parsedLimit: number; parsedOffset: number } {
    const parsedLimit = parseInt(String(limit), 10);
    const parsedOffset = parseInt(String(offset), 10);

    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      throw new HttpException('limit must be a positive integer', HttpStatus.BAD_REQUEST);
    }

    if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
      throw new HttpException('offset must be a non-negative integer', HttpStatus.BAD_REQUEST);
    }

    return { parsedLimit, parsedOffset };
  }

  private validateCreatePayload(body: {
    name: string;
    email: string;
    password: string;
    role: 'admin' | 'manager' | 'member';
    organizationId?: string;
  }): void {
    const allowedRoles = ['admin', 'manager', 'member'];

    if (!body?.name?.trim()) {
      throw new HttpException('name is required', HttpStatus.BAD_REQUEST);
    }

    if (!body?.email?.trim()) {
      throw new HttpException('email is required', HttpStatus.BAD_REQUEST);
    }

    if (!body?.password?.trim()) {
      throw new HttpException('password is required', HttpStatus.BAD_REQUEST);
    }

    if (body.password.length < PASSWORD_POLICY.minLength) {
      throw new HttpException(
        `password must be at least ${PASSWORD_POLICY.minLength} characters`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!allowedRoles.includes(body.role)) {
      throw new HttpException('invalid role', HttpStatus.BAD_REQUEST);
    }

    if (body.role !== 'admin' && !body.organizationId?.trim()) {
      throw new HttpException('organizationId is required for non-admin roles', HttpStatus.BAD_REQUEST);
    }
  }

  private validateSetRolePayload(body: { role: 'admin' | 'manager' | 'member' }): void {
    const allowedRoles = ['admin', 'manager', 'member'];
    if (!allowedRoles.includes(body.role)) {
      throw new HttpException('invalid role', HttpStatus.BAD_REQUEST);
    }
  }

  private validateSetPasswordPayload(body: { newPassword: string }): void {
    if (!body?.newPassword?.trim()) {
      throw new HttpException('newPassword is required', HttpStatus.BAD_REQUEST);
    }

    if (body.newPassword.length < PASSWORD_POLICY.minLength) {
      throw new HttpException(
        `newPassword must be at least ${PASSWORD_POLICY.minLength} characters`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private validateBulkRemovePayload(body: { userIds: string[] }): void {
    if (!Array.isArray(body?.userIds)) {
      throw new HttpException('userIds must be an array', HttpStatus.BAD_REQUEST);
    }
  }

  @Get('create-metadata')
  @RequirePermissions('user:read')
  async getCreateMetadata(@Session() session: UserSession) {
    const platformRole = requireAdminOrManager(session);
    const activeOrgId = requireActiveOrganizationIdForManager(platformRole, session);
    return this.adminService.getCreateUserMetadata(platformRole, activeOrgId);
  }

  @Get()
  @RequirePermissions('user:read')
  async list(
    @Session() session: UserSession,
    @Query('limit') limit = '10',
    @Query('offset') offset = '0',
    @Query('searchValue') searchValue?: string,
  ) {
    const { parsedLimit, parsedOffset } = this.validatePagination(limit, offset);

    const platformRole = requireAdminOrManager(session);
    const activeOrgId = requireActiveOrganizationIdForManager(platformRole, session);

    return this.adminService.listUsers({
      limit: parsedLimit,
      offset: parsedOffset,
      searchValue,
      platformRole,
      activeOrganizationId: activeOrgId,
    });
  }

  @Post('capabilities/batch')
  @RequirePermissions('user:read')
  async getBatchCapabilities(
    @Session() session: UserSession,
    @Body() body: { userIds: string[] },
  ) {
    const platformRole = requireAdminOrManager(session);
    const activeOrgId = requireActiveOrganizationIdForManager(platformRole, session);

    return this.adminService.getBatchCapabilities({
      actorUserId: session.user.id,
      userIds: Array.isArray(body?.userIds) ? body.userIds : [],
      platformRole,
      activeOrganizationId: activeOrgId,
    });
  }

  @Get(':userId/capabilities')
  @RequirePermissions('user:read')
  async getCapabilities(@Session() session: UserSession, @Param('userId') userId: string) {
    const platformRole = requireAdminOrManager(session);
    const activeOrgId = requireActiveOrganizationIdForManager(platformRole, session);

    return this.adminService.getUserCapabilities({
      actorUserId: session.user.id,
      targetUserId: userId,
      platformRole,
      activeOrganizationId: activeOrgId,
    });
  }

  @Post()
  @RequirePermissions('user:create')
  async create(
    @Session() session: UserSession,
    @Body()
    body: {
      name: string;
      email: string;
      password: string;
      role: 'admin' | 'manager' | 'member';
      organizationId?: string;
    },
  ) {
    this.validateCreatePayload(body);

    const platformRole = requireAdminOrManager(session);
    const activeOrgId = requireActiveOrganizationIdForManager(platformRole, session);

    return this.adminService.createUser(
      {
        name: body.name,
        email: body.email,
        password: body.password,
        role: body.role,
        organizationId: body.organizationId,
      },
      platformRole,
      activeOrgId,
    );
  }

  @Put(':userId')
  @RequirePermissions('user:update')
  async update(
    @Session() session: UserSession,
    @Param('userId') userId: string,
    @Body() body: { name?: string },
  ) {
    const platformRole = requireAdminOrManager(session);
    const activeOrgId = requireActiveOrganizationIdForManager(platformRole, session);
    return this.adminService.updateUser(
      { userId, name: body.name },
      platformRole,
      activeOrgId,
      session.user.id,
    );
  }

  @Put(':userId/role')
  @RequirePermissions('user:set-role')
  async setRole(
    @Session() session: UserSession,
    @Param('userId') userId: string,
    @Body() body: { role: 'admin' | 'manager' | 'member' },
  ) {
    this.validateSetRolePayload(body);

    const platformRole = requireAdminOrManager(session);
    const activeOrgId = requireActiveOrganizationIdForManager(platformRole, session);
    return this.adminService.setUserRole(
      { userId, role: body.role },
      platformRole,
      activeOrgId,
      session.user.id,
    );
  }

  @Post(':userId/ban')
  @RequirePermissions('user:ban')
  async ban(
    @Session() session: UserSession,
    @Param('userId') userId: string,
    @Body() body: { banReason?: string },
  ) {
    const platformRole = requireAdminOrManager(session);
    const activeOrgId = requireActiveOrganizationIdForManager(platformRole, session);
    return this.adminService.banUser(
      { userId, banReason: body.banReason },
      platformRole,
      activeOrgId,
      session.user.id,
    );
  }

  @Post(':userId/unban')
  @RequirePermissions('user:ban')
  async unban(@Session() session: UserSession, @Param('userId') userId: string) {
    const platformRole = requireAdminOrManager(session);
    const activeOrgId = requireActiveOrganizationIdForManager(platformRole, session);
    return this.adminService.unbanUser(
      { userId },
      platformRole,
      activeOrgId,
      session.user.id,
    );
  }

  @Post(':userId/password')
  @RequirePermissions('user:set-password')
  async setPassword(
    @Session() session: UserSession,
    @Param('userId') userId: string,
    @Body() body: { newPassword: string },
  ) {
    this.validateSetPasswordPayload(body);

    const platformRole = requireAdminOrManager(session);
    const activeOrgId = requireActiveOrganizationIdForManager(platformRole, session);
    return this.adminService.setUserPassword(
      { userId, newPassword: body.newPassword },
      platformRole,
      activeOrgId,
      session.user.id,
    );
  }

  @Post(':userId/impersonate')
  @RequirePermissions('user:impersonate')
  async impersonate(
    @Session() session: UserSession,
    @Param('userId') userId: string,
    @Body() body: { organizationId?: string },
  ) {
    const platformRole = requireAdminOrManager(session);
    const activeOrgId = requireActiveOrganizationIdForManager(platformRole, session);
    const result = await this.impersonationService.startImpersonation({
      actorUserId: session.user.id,
      targetUserId: userId,
      platformRole,
      activeOrganizationId: activeOrgId,
      organizationId: body?.organizationId,
    });

    return {
      success: true,
      sessionToken: result.sessionToken,
    };
  }

  @Delete(':userId')
  @RequirePermissions('user:delete')
  async remove(@Session() session: UserSession, @Param('userId') userId: string) {
    const platformRole = requireAdminOrManager(session);
    const activeOrgId = requireActiveOrganizationIdForManager(platformRole, session);
    return this.adminService.removeUser(
      { userId },
      platformRole,
      activeOrgId,
      session.user.id,
    );
  }

  @Post('bulk-delete')
  @RequirePermissions('user:delete')
  async bulkRemove(@Session() session: UserSession, @Body() body: { userIds: string[] }) {
    this.validateBulkRemovePayload(body);

    const platformRole = requireAdminOrManager(session);
    const activeOrgId = requireActiveOrganizationIdForManager(platformRole, session);
    return this.adminService.removeUsers(
      { userIds: body.userIds },
      platformRole,
      activeOrgId,
      session.user.id,
    );
  }

}
