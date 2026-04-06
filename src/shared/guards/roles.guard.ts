import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { ROLES_KEY } from '../decorators/roles.decorator';

type RolesRequest = {
  session?: UserSession;
};

/**
 * Guard that checks if the authenticated user has the required platform role.
 * Uses Better Auth session user.role for authorization.
 *
 * @example
 * @UseGuards(RolesGuard)
 * @Roles('admin')
 * @Controller('platform-admin')
 * export class AdminController { ... }
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RolesRequest>();
    const session = request.session;

    if (!session?.user) {
      throw new ForbiddenException('Authentication required');
    }

    const rawUserRole = session.user.role;
    const userRoles = Array.isArray(rawUserRole) ? rawUserRole : [rawUserRole];
    const hasRole = userRoles.some((userRole) =>
      requiredRoles.includes(userRole),
    );

    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied. Required role: ${requiredRoles.join(' or ')}`,
      );
    }

    return true;
  }
}
