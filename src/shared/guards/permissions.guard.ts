import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { RoleService } from '../../modules/admin/rbac/application/services';
import { DatabaseService } from '../infrastructure/database/database.module';
import {
  getActiveOrganizationId,
  getPlatformRole,
} from '../../modules/admin/users/utils/admin.utils';

type PermissionsRequest = {
  session?: UserSession;
};

/**
 * Guard that checks if the authenticated user has the required permissions.
 * Permissions are resolved via RoleService based on the user's platform role.
 *
 * @example
 * @UseGuards(PermissionsGuard)
 * @RequirePermissions('user:read')
 * @Get('users')
 * getUsers() { ... }
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private roleService: RoleService,
    private db: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<PermissionsRequest>();
    const session = request.session;

    if (!session?.user) {
      throw new ForbiddenException('Authentication required');
    }

    const platformRole = getPlatformRole(session);
    const activeOrganizationId = getActiveOrganizationId(session);

    if (platformRole === 'superadmin') {
      return true;
    }

    // Block pending/rejected users from accessing protected endpoints.
    // Wrapped in try-catch for resilience if the approvalStatus column
    // hasn't been created yet (migration not yet applied).
    try {
      const userApproval = await this.db.queryOne<{
        approvalStatus: string | null;
      }>('SELECT "approvalStatus" FROM "user" WHERE id = $1', [session.user.id]);

      if (userApproval) {
        const status = userApproval.approvalStatus;
        if (status === 'pending') {
          throw new ForbiddenException('ACCOUNT_PENDING_APPROVAL');
        }
        if (status === 'rejected') {
          throw new ForbiddenException('ACCOUNT_REJECTED');
        }
      }
    } catch (error) {
      // Re-throw ForbiddenException (approval check result)
      if (error instanceof ForbiddenException) throw error;
      // Swallow DB errors (e.g. column doesn't exist yet) — allow access
    }

    // user.role is NULL for non-superadmins after Phase 0 migration; resolve actual org membership role
    let effectiveRole: string = platformRole;
    if (activeOrganizationId && session.user?.id) {
      const memberRole = await this.roleService.getUserActiveMemberRole(
        session.user.id,
        activeOrganizationId,
      );
      if (memberRole) effectiveRole = memberRole;
    }

    const userPermissions = await this.getUserPermissions(
      effectiveRole,
      activeOrganizationId,
    );

    const hasAllPermissions = requiredPermissions.every((permission) =>
      userPermissions.includes(permission),
    );

    if (!hasAllPermissions) {
      const missing = requiredPermissions.filter(
        (p) => !userPermissions.includes(p),
      );
      throw new ForbiddenException(
        `Missing required permissions: ${missing.join(', ')}`,
      );
    }

    return true;
  }

  private async getUserPermissions(
    roleName: string,
    activeOrganizationId: string | null,
  ): Promise<string[]> {
    const permissions = await this.roleService.getUserPermissions(
      roleName,
      activeOrganizationId,
    );
    return permissions.map((p) => `${p.resource}:${p.action}`);
  }
}
