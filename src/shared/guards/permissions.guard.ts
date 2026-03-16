import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { RoleService } from '../../modules/admin/rbac/application/services';
import {
  getActiveOrganizationId,
  getPlatformRole,
} from '../../modules/admin/users/utils/admin.utils';

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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const session = request.session;

    if (!session?.user) {
      throw new ForbiddenException('Authentication required');
    }

    const platformRole = getPlatformRole(session);

    if (platformRole === 'superadmin') {
      return true;
    }

    const userPermissions = await this.getUserPermissions(
      platformRole,
      getActiveOrganizationId(session),
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
