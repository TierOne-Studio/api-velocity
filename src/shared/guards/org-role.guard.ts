import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserSession } from '@thallesp/nestjs-better-auth';

export const ORG_ROLES_KEY = 'orgRoles';

type OrgRoleRequest = {
  session?: UserSession;
  orgMemberRole?: string;
};

/**
 * Decorator to specify required organization roles for a route handler.
 * Used with OrgRoleGuard to enforce org-scoped role checks.
 *
 * Unified Role Model:
 * - 'admin': Global platform administrator (can manage all orgs)
 * - 'manager': Organization manager (can manage their org)
 * - 'member': Organization member (basic access)
 *
 * @example
 * @OrgRoles('admin', 'manager')
 * @Put('settings')
 * updateSettings() { ... }
 */
export const OrgRoles = (...roles: string[]) => {
  return (
    target: object,
    key?: string | symbol,
    descriptor?: PropertyDescriptor,
  ) => {
    if (descriptor) {
      Reflect.defineMetadata(ORG_ROLES_KEY, roles, descriptor.value);
    } else {
      Reflect.defineMetadata(ORG_ROLES_KEY, roles, target);
    }
    return descriptor ?? target;
  };
};

/**
 * Guard that checks if the authenticated user has the required organization role.
 * Requires organizationId to be present in route params.
 * Uses Better Auth member.role for authorization.
 */
@Injectable()
export class OrgRoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ORG_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<OrgRoleRequest>();
    const session = request.session;

    if (!session?.user) {
      throw new ForbiddenException('Authentication required');
    }

    const orgMemberRole = request.orgMemberRole;

    if (!orgMemberRole) {
      throw new ForbiddenException('Organization membership required');
    }

    const hasRole = requiredRoles.includes(orgMemberRole);

    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied. Required org role: ${requiredRoles.join(' or ')}`,
      );
    }

    return true;
  }
}
